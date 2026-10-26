import { roleCan } from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	buyerIntents,
	buyingTimelines,
	closedLeadStatuses,
	contact,
	contactActivityTypes,
	contactPhone,
	type FitResult,
	incomeRanges,
	lead,
	liveOpportunityStatuses,
	member,
	opportunity,
	projectMember,
	unit,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { normalizePhone } from "../phone";
import { writeAudit } from "./audit";
import { requireActiveCampaign } from "./campaign";
import { badRequest, forbidden } from "./errors";
import { ensureDefaultSources, requireActiveSource } from "./lead-source";
import { deadlineFor } from "./pool";
import { availablePriceRange } from "./project";
import { autoQualifyIfFits, checkUnitTypes } from "./qualify";
import { findReferrer } from "./referrer";
import { getRules } from "./rules";
import { requireProject } from "./scope";
import { scoreInterest } from "./scoring";
import type { Tenant } from "./tenancy";
import { satang } from "./validation";

export const captureEnquiryInput = z
	.strictObject({
		projectId: z.uuid(),
		name: z.string().trim().min(1).max(120),
		phone: z.string().trim().min(3).max(40),
		sourceId: z.uuid(),
		campaignId: z.uuid().optional(),
		marketingConsent: z.boolean(),
		/** Managers: a member to own it, or null for the pool. Salespeople: omit (it's theirs). */
		ownerMemberId: z.string().min(1).nullable().optional(),
		nextFollowUpAt: z.iso.datetime({ offset: true }).optional(),
		budgetMinSatang: satang.optional(),
		budgetMaxSatang: satang.optional(),
		buyingTimeline: z.enum(buyingTimelines).optional(),
		unitTypeIds: z.array(z.uuid()).max(50).optional(),
		buyerIntent: z.enum(buyerIntents).optional(),
		incomeRange: z.enum(incomeRanges).optional(),
		/** Referral sources: the phone of the contact who referred them. */
		referrerPhone: z.string().trim().min(3).max(40).optional(),
		/** When the enquiry really came in (forgot to log a walk-in): ≤ now, ≤ 30 days back. */
		receivedAt: z.iso.datetime({ offset: true }).optional(),
		note: z.string().trim().max(1000).optional(),
	})
	.refine(
		(v) =>
			v.budgetMinSatang === undefined ||
			v.budgetMaxSatang === undefined ||
			v.budgetMinSatang <= v.budgetMaxSatang,
		{ message: "Minimum budget is above maximum", path: ["budgetMaxSatang"] },
	);

export type CaptureOutcome =
	| "new_contact"
	| "new_lead"
	| "re_enquiry_kept"
	| "re_enquiry_pooled"
	| "re_enquiry_logged";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const MAX_RECEIVED_AGE_MS = 30 * 86_400_000;

/** The member who may own a lead in this project: a salesperson or manager covering it. */
async function requireOwnerCandidate(
	tx: Tx,
	tenant: Tenant,
	memberId: string,
	projectId: string,
) {
	const [row] = await tx
		.select({ role: member.role })
		.from(member)
		.innerJoin(
			projectMember,
			and(
				eq(projectMember.memberId, member.id),
				eq(projectMember.projectId, projectId),
			),
		)
		.where(
			and(
				eq(member.id, memberId),
				eq(member.organizationId, tenant.organizationId),
			),
		);
	if (!row || !["salesperson", "sales_manager"].includes(row.role)) {
		badRequest(
			"The owner must be a salesperson or manager covering this project",
		);
	}
}

/** Whether the owner logged a real contact (call, LINE, meeting, visit) within the window. */
async function ownerContactedSince(
	tx: Tx,
	leadId: string,
	ownerMemberId: string,
	since: Date,
) {
	const [row] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(activity)
		.innerJoin(member, eq(member.id, ownerMemberId))
		.where(
			and(
				eq(activity.leadId, leadId),
				inArray(activity.type, [...contactActivityTypes]),
				eq(activity.byUserId, member.userId),
				gte(activity.at, since),
			),
		);
	return (row?.n ?? 0) > 0;
}

/**
 * Quick capture (brief §6): one enquiry → contact (deduped by phone) and an
 * lead in the project. Salesperson-logged enquiries are theirs at once;
 * managers pick an owner or the pool. An existing lead in the same project
 * gets an `enquiry` activity and the re-enquiry rule decides the owner.
 */
export async function captureEnquiry(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof captureEnquiryInput>,
): Promise<{
	contactId: string;
	leadId: string;
	outcome: CaptureOutcome;
	fit: FitResult;
	/** Qualified by the project's auto-qualify rule. */
	qualified: boolean;
}> {
	const phone = normalizePhone(input.phone);
	if (!phone) badRequest("Invalid phone number");
	const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
	// A minute of slack for clock drift between the phone and the server.
	if (receivedAt.getTime() > Date.now() + 60_000) {
		badRequest("The received time can't be in the future");
	}
	if (receivedAt.getTime() < Date.now() - MAX_RECEIVED_AGE_MS) {
		badRequest("The received time can be at most 30 days back");
	}

	const canAssign = roleCan(tenant.role, { lead: ["assign"] });
	if (
		!canAssign &&
		input.ownerMemberId !== undefined &&
		input.ownerMemberId !== tenant.memberId
	) {
		forbidden("Only managers choose the owner");
	}
	if (canAssign && input.ownerMemberId === undefined) {
		badRequest("Choose an owner or the pool");
	}
	const ownerMemberId = canAssign
		? (input.ownerMemberId ?? null)
		: tenant.memberId;
	const selfLogged = ownerMemberId === tenant.memberId;
	if (selfLogged && !input.nextFollowUpAt) {
		badRequest("A next follow-up is required for your own leads");
	}

	return db.transaction(async (tx) => {
		const proj = await requireProject(tx, tenant, input.projectId);
		await ensureDefaultSources(tx, tenant.organizationId);
		const source = await requireActiveSource(tx, tenant, input.sourceId);
		if (input.campaignId) {
			const camp = await requireActiveCampaign(
				tx,
				tenant,
				input.campaignId,
				proj.id,
			);
			if (source.channelId && camp.channelId !== source.channelId) {
				badRequest("The campaign belongs to another channel");
			}
		}
		// In person (walk-in, event): budget, timeline, unit types and intent are required.
		if (source.inPerson) {
			if (
				input.budgetMinSatang === undefined ||
				input.budgetMaxSatang === undefined ||
				!input.buyingTimeline ||
				!input.buyerIntent
			) {
				badRequest(
					"In-person leads need budget, timeline, unit types and intent",
				);
			}
		}
		const unitTypeIds =
			input.unitTypeIds !== undefined || source.inPerson
				? await checkUnitTypes(
						tx,
						proj.id,
						input.unitTypeIds ?? [],
						source.inPerson,
					)
				: undefined;
		if (ownerMemberId && !selfLogged) {
			await requireOwnerCandidate(tx, tenant, ownerMemberId, proj.id);
		} else if (
			selfLogged &&
			!["salesperson", "sales_manager"].includes(tenant.role)
		) {
			badRequest("Only salespeople and managers can own leads");
		}

		// Serialise captures of the same phone so one contact is created, not two.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`${tenant.organizationId}:${phone}`}, 0))`,
		);

		const rules = await getRules(tx, tenant.organizationId);
		const [range] = await tx
			.select(availablePriceRange())
			.from(unit)
			.where(and(eq(unit.projectId, proj.id), eq(unit.status, "available")));
		const now = new Date();

		// Contact: existing by phone, or new with the consent record.
		const [existingPhone] = await tx
			.select({ contactId: contactPhone.contactId })
			.from(contactPhone)
			.where(
				and(
					eq(contactPhone.organizationId, tenant.organizationId),
					eq(contactPhone.phoneE164, phone),
				),
			);
		let contactId = existingPhone?.contactId;
		let outcome: CaptureOutcome = "new_lead";
		if (!contactId) {
			const [created] = await tx
				.insert(contact)
				.values({
					organizationId: tenant.organizationId,
					name: input.name,
					marketingConsent: input.marketingConsent,
					consentRecordedByUserId: tenant.userId,
					consentRecordedAt: now,
					createdByUserId: tenant.userId,
				})
				.returning({ id: contact.id });
			if (!created) throw new Error("insert returned no row");
			contactId = created.id;
			await tx.insert(contactPhone).values({
				organizationId: tenant.organizationId,
				contactId,
				phoneE164: phone,
				isPrimary: true,
			});
			outcome = "new_contact";
		} else if (input.marketingConsent) {
			// A capture can give consent but never silently withdraws it.
			const updated = await tx
				.update(contact)
				.set({
					marketingConsent: true,
					consentRecordedByUserId: tenant.userId,
					consentRecordedAt: now,
				})
				.where(
					and(eq(contact.id, contactId), eq(contact.marketingConsent, false)),
				)
				.returning({ id: contact.id });
			if (updated.length > 0) {
				await writeAudit(tx, tenant, {
					action: "contact.consent_change",
					entityType: "contact",
					entityId: contactId,
					before: { marketingConsent: false },
					after: { marketingConsent: true },
				});
			}
		}

		const referrer = input.referrerPhone
			? await findReferrer(tx, tenant, input.referrerPhone, contactId)
			: null;

		const [existing] = await tx
			.select()
			.from(lead)
			.where(and(eq(lead.contactId, contactId), eq(lead.projectId, proj.id)))
			.for("update");

		const budgetMinSatang =
			input.budgetMinSatang ?? existing?.budgetMinSatang ?? null;
		const budgetMaxSatang =
			input.budgetMaxSatang ?? existing?.budgetMaxSatang ?? null;
		const buyingTimeline =
			input.buyingTimeline ?? existing?.buyingTimeline ?? null;
		const score = scoreInterest(
			{
				budgetMinSatang,
				budgetMaxSatang,
				buyingTimeline,
				priceRange:
					range?.minPriceSatang != null && range.maxPriceSatang != null
						? { min: range.minPriceSatang, max: range.maxPriceSatang }
						: null,
			},
			rules,
		);
		const snapshot = {
			via: "quick_capture",
			sourceId: input.sourceId,
			campaignId: input.campaignId ?? null,
			budgetMinSatang,
			budgetMaxSatang,
			buyingTimeline,
			priority: score.priority,
			prioritySignals: score.signals,
			scoringVersion: score.version,
		};
		const log = (
			values: Omit<typeof activity.$inferInsert, "organizationId">,
		) =>
			tx
				.insert(activity)
				.values({ organizationId: tenant.organizationId, ...values });

		if (!existing) {
			// Assigned by a manager: contact the same working day, like a claim.
			const contactDeadlineAt =
				ownerMemberId && !selfLogged
					? await deadlineFor(tx, proj, rules.deadlineRollHours, now)
					: null;
			const [created] = await tx
				.insert(lead)
				.values({
					organizationId: tenant.organizationId,
					contactId,
					projectId: proj.id,
					ownerMemberId,
					sourceId: input.sourceId,
					campaignId: input.campaignId,
					budgetMinSatang,
					budgetMaxSatang,
					buyingTimeline,
					unitTypeIds: unitTypeIds ?? [],
					buyerIntent: input.buyerIntent ?? null,
					incomeRange: input.incomeRange ?? null,
					referredByContactId: referrer?.id ?? null,
					priority: score.priority,
					prioritySignals: score.signals,
					scoringVersion: score.version,
					scoredAt: now,
					createdAt: receivedAt,
					nextFollowUpAt: input.nextFollowUpAt
						? new Date(input.nextFollowUpAt)
						: null,
					contactDeadlineAt,
				})
				.returning({ id: lead.id });
			if (!created) throw new Error("insert returned no row");
			await log({
				leadId: created.id,
				type: "enquiry",
				at: receivedAt,
				byUserId: tenant.userId,
				note: input.note,
				campaignId: input.campaignId,
				data: { ...snapshot, ownerMemberId },
			});
			if (ownerMemberId && !selfLogged) {
				await log({
					leadId: created.id,
					type: "assignment",
					byUserId: tenant.userId,
					data: { from: null, to: ownerMemberId },
				});
				await writeAudit(tx, tenant, {
					action: "lead.assign",
					entityType: "lead",
					entityId: created.id,
					before: { ownerMemberId: null },
					after: { ownerMemberId },
				});
			}
			const { fit, qualified } = await autoQualifyIfFits(
				tx,
				tenant.organizationId,
				proj,
				{
					id: created.id,
					status: "new",
					budgetMinSatang,
					budgetMaxSatang,
					buyingTimeline,
					unitTypeIds: unitTypeIds ?? [],
					buyerIntent: input.buyerIntent ?? null,
				},
			);
			return { contactId, leadId: created.id, outcome, fit, qualified };
		}

		// Re-enquiry on the existing lead (brief §6). A live opportunity only logs it.
		const [live] =
			existing.status === "converted"
				? await tx
						.select({ id: opportunity.id })
						.from(opportunity)
						.where(
							and(
								eq(opportunity.leadId, existing.id),
								inArray(opportunity.status, [...liveOpportunityStatuses]),
							),
						)
				: [];
		await log({
			leadId: existing.id,
			opportunityId: live?.id,
			type: "enquiry",
			at: receivedAt,
			byUserId: tenant.userId,
			note: input.note,
			campaignId: input.campaignId,
			data: { ...snapshot, reEnquiry: true },
		});
		const changes: Partial<typeof lead.$inferInsert> = {
			budgetMinSatang,
			budgetMaxSatang,
			buyingTimeline,
			...(unitTypeIds && { unitTypeIds }),
			...(input.buyerIntent && { buyerIntent: input.buyerIntent }),
			...(input.incomeRange && { incomeRange: input.incomeRange }),
			...(referrer && { referredByContactId: referrer.id }),
			priority: score.priority,
			prioritySignals: score.signals,
			scoringVersion: score.version,
			scoredAt: now,
		};
		if (live) {
			await tx.update(lead).set(changes).where(eq(lead.id, existing.id));
			return {
				contactId,
				leadId: existing.id,
				outcome: "re_enquiry_logged",
				fit: "unknown",
				qualified: false,
			};
		}

		const since = new Date(
			now.getTime() - rules.reEnquiryWindowDays * 86_400_000,
		);
		const keep =
			existing.ownerMemberId !== null &&
			(await ownerContactedSince(
				tx,
				existing.id,
				existing.ownerMemberId,
				since,
			));
		// Disqualified, nurturing, or converted with every opportunity lost: start over.
		if (
			closedLeadStatuses.includes(existing.status) ||
			existing.status === "converted"
		) {
			changes.status = "new";
			changes.disqualifyReason = null;
			await log({
				leadId: existing.id,
				type: "status_change",
				data: { from: existing.status, to: "new", reason: "re_enquiry" },
			});
		}
		if (!keep) {
			changes.ownerMemberId = null;
			changes.claimedAt = null;
			changes.contactDeadlineAt = null;
			await log({
				leadId: existing.id,
				type: "re_engagement",
				campaignId: input.campaignId,
				data: { from: existing.ownerMemberId, to: null },
			});
			if (existing.ownerMemberId) {
				await writeAudit(tx, tenant, {
					action: "lead.assign",
					entityType: "lead",
					entityId: existing.id,
					before: { ownerMemberId: existing.ownerMemberId },
					after: { ownerMemberId: null, reason: "re_enquiry" },
				});
			}
		}
		await tx.update(lead).set(changes).where(eq(lead.id, existing.id));
		const { fit, qualified } = await autoQualifyIfFits(
			tx,
			tenant.organizationId,
			proj,
			{
				id: existing.id,
				status: changes.status ?? existing.status,
				budgetMinSatang,
				budgetMaxSatang,
				buyingTimeline,
				unitTypeIds: unitTypeIds ?? existing.unitTypeIds,
				buyerIntent: input.buyerIntent ?? existing.buyerIntent,
			},
		);
		return {
			contactId,
			leadId: existing.id,
			outcome: keep ? "re_enquiry_kept" : "re_enquiry_pooled",
			fit,
			qualified,
		};
	});
}
