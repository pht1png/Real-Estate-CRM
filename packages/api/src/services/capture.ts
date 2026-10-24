import { roleCan } from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import {
	buyingTimelines,
	closedStages,
	contactActivityTypes,
	customer,
	customerPhone,
	interest,
	interestActivity,
	member,
	projectMember,
	soldStages,
	unit,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { normalizePhone } from "../phone";
import { writeAudit } from "./audit";
import { requireActiveCampaign } from "./campaign";
import { badRequest, forbidden } from "./errors";
import { ensureDefaultSources, requireActiveSource } from "./lead-source";
import { availablePriceRange } from "./project";
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
	| "new_customer"
	| "new_interest"
	| "re_enquiry_kept"
	| "re_enquiry_pooled"
	| "re_enquiry_logged";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

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
	interestId: string,
	ownerMemberId: string,
	since: Date,
) {
	const [row] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(interestActivity)
		.innerJoin(member, eq(member.id, ownerMemberId))
		.where(
			and(
				eq(interestActivity.interestId, interestId),
				inArray(interestActivity.type, [...contactActivityTypes]),
				eq(interestActivity.byUserId, member.userId),
				gte(interestActivity.at, since),
			),
		);
	return (row?.n ?? 0) > 0;
}

/**
 * Quick capture (brief §6): one enquiry → customer (deduped by phone) and an
 * interest in the project. Salesperson-logged enquiries are theirs at once;
 * managers pick an owner or the pool. An existing interest in the same project
 * gets an `enquiry` activity and the re-enquiry rule decides the owner.
 */
export async function captureEnquiry(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof captureEnquiryInput>,
): Promise<{
	customerId: string;
	interestId: string;
	outcome: CaptureOutcome;
}> {
	const phone = normalizePhone(input.phone);
	if (!phone) badRequest("Invalid phone number");

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
		if (ownerMemberId && !selfLogged) {
			await requireOwnerCandidate(tx, tenant, ownerMemberId, proj.id);
		} else if (
			selfLogged &&
			!["salesperson", "sales_manager"].includes(tenant.role)
		) {
			badRequest("Only salespeople and managers can own leads");
		}

		// Serialise captures of the same phone so one customer is created, not two.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`${tenant.organizationId}:${phone}`}, 0))`,
		);

		const rules = await getRules(tx, tenant.organizationId);
		const [range] = await tx
			.select(availablePriceRange())
			.from(unit)
			.where(and(eq(unit.projectId, proj.id), eq(unit.status, "available")));
		const now = new Date();

		// Customer: existing by phone, or new with the consent record.
		const [existingPhone] = await tx
			.select({ customerId: customerPhone.customerId })
			.from(customerPhone)
			.where(
				and(
					eq(customerPhone.organizationId, tenant.organizationId),
					eq(customerPhone.phoneE164, phone),
				),
			);
		let customerId = existingPhone?.customerId;
		let outcome: CaptureOutcome = "new_interest";
		if (!customerId) {
			const [created] = await tx
				.insert(customer)
				.values({
					organizationId: tenant.organizationId,
					name: input.name,
					marketingConsent: input.marketingConsent,
					consentRecordedByUserId: tenant.userId,
					consentRecordedAt: now,
					createdByUserId: tenant.userId,
				})
				.returning({ id: customer.id });
			if (!created) throw new Error("insert returned no row");
			customerId = created.id;
			await tx.insert(customerPhone).values({
				organizationId: tenant.organizationId,
				customerId,
				phoneE164: phone,
				isPrimary: true,
			});
			outcome = "new_customer";
		} else if (input.marketingConsent) {
			// A capture can give consent but never silently withdraws it.
			const updated = await tx
				.update(customer)
				.set({
					marketingConsent: true,
					consentRecordedByUserId: tenant.userId,
					consentRecordedAt: now,
				})
				.where(
					and(
						eq(customer.id, customerId),
						eq(customer.marketingConsent, false),
					),
				)
				.returning({ id: customer.id });
			if (updated.length > 0) {
				await writeAudit(tx, tenant, {
					action: "customer.consent_change",
					entityType: "customer",
					entityId: customerId,
					before: { marketingConsent: false },
					after: { marketingConsent: true },
				});
			}
		}

		const [existing] = await tx
			.select()
			.from(interest)
			.where(
				and(
					eq(interest.customerId, customerId),
					eq(interest.projectId, proj.id),
				),
			)
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
		const activity = (
			values: Omit<typeof interestActivity.$inferInsert, "organizationId">,
		) =>
			tx
				.insert(interestActivity)
				.values({ organizationId: tenant.organizationId, ...values });

		if (!existing) {
			const [created] = await tx
				.insert(interest)
				.values({
					organizationId: tenant.organizationId,
					customerId,
					projectId: proj.id,
					ownerMemberId,
					sourceId: input.sourceId,
					campaignId: input.campaignId,
					budgetMinSatang,
					budgetMaxSatang,
					buyingTimeline,
					priority: score.priority,
					prioritySignals: score.signals,
					scoringVersion: score.version,
					scoredAt: now,
					nextFollowUpAt: input.nextFollowUpAt
						? new Date(input.nextFollowUpAt)
						: null,
				})
				.returning({ id: interest.id });
			if (!created) throw new Error("insert returned no row");
			await activity({
				interestId: created.id,
				type: "enquiry",
				byUserId: tenant.userId,
				note: input.note,
				campaignId: input.campaignId,
				data: { ...snapshot, ownerMemberId },
			});
			if (ownerMemberId && !selfLogged) {
				await activity({
					interestId: created.id,
					type: "assignment",
					byUserId: tenant.userId,
					data: { from: null, to: ownerMemberId },
				});
				await writeAudit(tx, tenant, {
					action: "interest.assign",
					entityType: "interest",
					entityId: created.id,
					before: { ownerMemberId: null },
					after: { ownerMemberId },
				});
			}
			return { customerId, interestId: created.id, outcome };
		}

		// Re-enquiry on the existing interest (brief §6).
		await activity({
			interestId: existing.id,
			type: "enquiry",
			byUserId: tenant.userId,
			note: input.note,
			campaignId: input.campaignId,
			data: { ...snapshot, reEnquiry: true },
		});
		const changes: Partial<typeof interest.$inferInsert> = {
			budgetMinSatang,
			budgetMaxSatang,
			buyingTimeline,
			priority: score.priority,
			prioritySignals: score.signals,
			scoringVersion: score.version,
			scoredAt: now,
		};
		if (soldStages.includes(existing.stage)) {
			await tx
				.update(interest)
				.set(changes)
				.where(eq(interest.id, existing.id));
			return {
				customerId,
				interestId: existing.id,
				outcome: "re_enquiry_logged",
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
		if (closedStages.includes(existing.stage)) {
			changes.stage = "new";
			await activity({
				interestId: existing.id,
				type: "stage_change",
				data: { from: existing.stage, to: "new", reason: "re_enquiry" },
			});
		}
		if (!keep) {
			changes.ownerMemberId = null;
			changes.claimedAt = null;
			await activity({
				interestId: existing.id,
				type: "re_engagement",
				campaignId: input.campaignId,
				data: { from: existing.ownerMemberId, to: null },
			});
			if (existing.ownerMemberId) {
				await writeAudit(tx, tenant, {
					action: "interest.assign",
					entityType: "interest",
					entityId: existing.id,
					before: { ownerMemberId: existing.ownerMemberId },
					after: { ownerMemberId: null, reason: "re_enquiry" },
				});
			}
		}
		await tx.update(interest).set(changes).where(eq(interest.id, existing.id));
		return {
			customerId,
			interestId: existing.id,
			outcome: keep ? "re_enquiry_kept" : "re_enquiry_pooled",
		};
	});
}
