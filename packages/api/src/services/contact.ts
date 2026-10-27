import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	appointment,
	campaign,
	contact,
	contactPhone,
	lead,
	leadSource,
	leadStatuses,
	member,
	opportunity,
	opportunityStatuses,
	project,
	user,
} from "@Real-Estate-CRM/db/schema/index";
import {
	aliasedTable,
	and,
	asc,
	desc,
	eq,
	ilike,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { z } from "zod";

import { formatPhone, normalizePhone } from "../phone";
import { writeAudit } from "./audit";
import { badRequest, conflict, notFound } from "./errors";
import { assessFit, qualificationRulesOf } from "./fit";
import {
	canSeeLead,
	visibleLeadCondition,
	visibleOpportunityCondition,
} from "./lead-access";
import { liveTemperature } from "./temperature";
import type { Tenant } from "./tenancy";

type Executor = Pick<Database, "select">;

export const phoneLookupInput = z.strictObject({
	phone: z.string().trim().max(40),
});
export const contactIdInput = z.strictObject({ contactId: z.uuid() });
const search = z.string().trim().max(120).optional();
export const listLeadsInput = z.strictObject({
	query: search,
	projectId: z.uuid().optional(),
	statuses: z.array(z.enum(leadStatuses)).max(leadStatuses.length).optional(),
	ownership: z.enum(["mine", "pool", "all"]).optional(),
});
export const listOpportunitiesInput = z.strictObject({
	query: search,
	projectId: z.uuid().optional(),
	statuses: z
		.array(z.enum(opportunityStatuses))
		.max(opportunityStatuses.length)
		.optional(),
	ownership: z.enum(["mine", "all"]).optional(),
});
export const updateContactInput = z.strictObject({
	contactId: z.uuid(),
	name: z.string().trim().min(1).max(120).optional(),
	lineId: z.string().trim().max(80).nullable().optional(),
	email: z.email().max(200).nullable().optional(),
});
export const contactPhoneInput = z.strictObject({
	contactId: z.uuid(),
	phone: z.string().trim().min(3).max(40),
});
export const consentInput = z.strictObject({
	contactId: z.uuid(),
	marketingConsent: z.boolean(),
});

const ownerUser = aliasedTable(user, "owner_user");

/** The latest opportunity status of the outer `lead` row (null until converted). */
const latestOpportunityStatus = sql<
	(typeof opportunityStatuses)[number] | null
>`(select o.status from opportunity o where o.lead_id = ${sql.raw(`"lead"."id"`)} order by o.created_at desc limit 1)`;

/** Every lead of a contact, with project, owner and opportunity status (no private fields). */
function leadSummaries(
	db: Executor,
	organizationId: string,
	contactIds: string[],
) {
	return db
		.select({
			id: lead.id,
			contactId: lead.contactId,
			projectId: lead.projectId,
			projectName: project.name,
			status: lead.status,
			opportunityStatus: latestOpportunityStatus,
			ownerMemberId: lead.ownerMemberId,
			ownerName: ownerUser.name,
		})
		.from(lead)
		.innerJoin(project, eq(project.id, lead.projectId))
		.leftJoin(member, eq(member.id, lead.ownerMemberId))
		.leftJoin(ownerUser, eq(ownerUser.id, member.userId))
		.where(
			and(
				eq(lead.organizationId, organizationId),
				inArray(lead.contactId, contactIds),
			),
		)
		.orderBy(asc(project.name));
}

/**
 * Duplicate check while typing (brief §6): the contact behind a phone, with a
 * summary line per project (project · lead or opportunity status · owner) — never
 * private details.
 */
export async function lookupByPhone(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof phoneLookupInput>,
) {
	const phone = normalizePhone(input.phone);
	if (!phone) return { phone: null, contact: null };
	const [match] = await db
		.select({ id: contact.id, name: contact.name })
		.from(contactPhone)
		.innerJoin(contact, eq(contact.id, contactPhone.contactId))
		.where(
			and(
				eq(contactPhone.organizationId, tenant.organizationId),
				eq(contactPhone.phoneE164, phone),
			),
		);
	if (!match) return { phone, contact: null };
	const leads = await leadSummaries(db, tenant.organizationId, [match.id]);
	return {
		phone,
		contact: {
			...match,
			leads: leads.map(
				({ projectId, projectName, status, opportunityStatus, ownerName }) => ({
					projectId,
					projectName,
					status,
					opportunityStatus,
					ownerName,
				}),
			),
		},
	};
}

/** The contact if the tenant may open their page: unscoped roles, or any visible lead. */
async function requireContactAccess(
	db: Executor,
	tenant: Tenant,
	contactId: string,
) {
	const [row] = await db
		.select()
		.from(contact)
		.where(
			and(
				eq(contact.id, contactId),
				eq(contact.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Contact");
	if (tenant.projectIds !== null) {
		const [visible] = await db
			.select({ id: lead.id })
			.from(lead)
			.where(and(eq(lead.contactId, contactId), visibleLeadCondition(tenant)))
			.limit(1);
		if (!visible) notFound("Contact");
	}
	return row;
}

/**
 * Contact page: shared profile; per visible project the lead (vetting) and
 * its latest opportunity, its appointments and one timeline; summary lines
 * for the rest.
 */
export async function getContact(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof contactIdInput>,
) {
	const row = await requireContactAccess(db, tenant, input.contactId);
	const consentBy = aliasedTable(user, "consent_user");
	const [[consent], phones, summaries] = await Promise.all([
		db
			.select({ name: consentBy.name })
			.from(consentBy)
			.where(eq(consentBy.id, row.consentRecordedByUserId ?? "")),
		db
			.select({
				phoneE164: contactPhone.phoneE164,
				isPrimary: contactPhone.isPrimary,
			})
			.from(contactPhone)
			.where(eq(contactPhone.contactId, row.id))
			.orderBy(desc(contactPhone.isPrimary), asc(contactPhone.createdAt)),
		leadSummaries(db, tenant.organizationId, [row.id]),
	]);

	const visibleIds = summaries
		.filter((s) => canSeeLead(tenant, s))
		.map((s) => s.id);
	const hostUser = aliasedTable(user, "host_user");
	const referrer = aliasedTable(contact, "referrer");
	const [details, opportunities, appointments, activities] = visibleIds.length
		? await Promise.all([
				db
					.select({
						lead,
						sourceName: leadSource.name,
						campaignName: campaign.name,
						campaignCode: campaign.code,
						referrerId: referrer.id,
						referrerName: referrer.name,
						qualificationRules: project.qualificationRules,
						minPriceSatang: sql<
							number | null
						>`(select min(u.list_price_satang)::float8 from unit u where u.project_id = ${lead.projectId} and u.status = 'available')`,
						maxPriceSatang: sql<
							number | null
						>`(select max(u.list_price_satang)::float8 from unit u where u.project_id = ${lead.projectId} and u.status = 'available')`,
					})
					.from(lead)
					.innerJoin(leadSource, eq(leadSource.id, lead.sourceId))
					.innerJoin(project, eq(project.id, lead.projectId))
					.leftJoin(campaign, eq(campaign.id, lead.campaignId))
					.leftJoin(referrer, eq(referrer.id, lead.referredByContactId))
					.where(inArray(lead.id, visibleIds)),
				db
					.select()
					.from(opportunity)
					.where(inArray(opportunity.leadId, visibleIds))
					.orderBy(desc(opportunity.createdAt)),
				db
					.select({
						id: appointment.id,
						leadId: appointment.leadId,
						opportunityId: appointment.opportunityId,
						memberId: appointment.memberId,
						hostName: hostUser.name,
						startsAt: appointment.startsAt,
						endsAt: appointment.endsAt,
						status: appointment.status,
						cancelReason: appointment.cancelReason,
					})
					.from(appointment)
					.innerJoin(member, eq(member.id, appointment.memberId))
					.innerJoin(hostUser, eq(hostUser.id, member.userId))
					.where(inArray(appointment.leadId, visibleIds))
					.orderBy(desc(appointment.startsAt)),
				db
					.select({
						id: activity.id,
						leadId: activity.leadId,
						opportunityId: activity.opportunityId,
						type: activity.type,
						at: activity.at,
						note: activity.note,
						byName: user.name,
						data: activity.data,
					})
					.from(activity)
					.leftJoin(user, eq(user.id, activity.byUserId))
					.where(inArray(activity.leadId, visibleIds))
					.orderBy(desc(activity.at)),
			])
		: [[], [], [], []];

	return {
		id: row.id,
		name: row.name,
		lineId: row.lineId,
		email: row.email,
		phones: phones.map((p) => ({ ...p, display: formatPhone(p.phoneE164) })),
		marketingConsent: row.marketingConsent,
		consentRecordedAt: row.consentRecordedAt,
		consentRecordedBy: consent?.name ?? null,
		leads: summaries.map((s) => {
			const d = details.find((x) => x.lead.id === s.id);
			if (!d) {
				// Brief §4: other salespeople see only project · status · owner.
				return {
					visible: false as const,
					id: s.id,
					projectName: s.projectName,
					status: s.status,
					opportunityStatus: s.opportunityStatus,
					ownerName: s.ownerName,
				};
			}
			const l = d.lead;
			const opp = opportunities.find((o) => o.leadId === l.id) ?? null;
			const priceRange =
				d.minPriceSatang !== null && d.maxPriceSatang !== null
					? { min: d.minPriceSatang, max: d.maxPriceSatang }
					: null;
			const rules = qualificationRulesOf(d);
			return {
				visible: true as const,
				id: l.id,
				projectId: l.projectId,
				projectName: s.projectName,
				status: l.status,
				disqualifyReason: l.disqualifyReason,
				ownerMemberId: l.ownerMemberId,
				ownerName: s.ownerName,
				sourceName: d.sourceName,
				campaignName: d.campaignName,
				campaignCode: d.campaignCode,
				priority: l.priority,
				prioritySignals: l.prioritySignals,
				budgetMinSatang: l.budgetMinSatang,
				budgetMaxSatang: l.budgetMaxSatang,
				buyingTimeline: l.buyingTimeline,
				unitTypeIds: l.unitTypeIds,
				buyerIntent: l.buyerIntent,
				incomeRange: l.incomeRange,
				referredBy: d.referrerId
					? { id: d.referrerId, name: d.referrerName ?? "" }
					: null,
				qualifiedAt: l.qualifiedAt,
				convertedAt: l.convertedAt,
				nextFollowUpAt: l.nextFollowUpAt,
				contactDeadlineAt: l.contactDeadlineAt,
				fit: assessFit({ ...l, priceRange }, rules),
				projectMinPriceSatang: d.minPriceSatang,
				projectMaxPriceSatang: d.maxPriceSatang,
				createdAt: l.createdAt,
				opportunity: opp && {
					id: opp.id,
					status: opp.status,
					lostReason: opp.lostReason,
					fundingType: opp.fundingType,
					ownerMemberId: opp.ownerMemberId,
					firstVisitAt: opp.firstVisitAt,
					lastVisitAt: opp.lastVisitAt,
					visitCount: opp.visitCount,
					nextFollowUpAt: opp.nextFollowUpAt,
					temperature: liveTemperature(opp, l, priceRange, rules),
				},
				appointments: appointments
					.filter((a) => a.leadId === l.id)
					.map((a) => ({
						...a,
						// No opportunity at booking = the first tour (brief §6).
						kind: a.opportunityId
							? ("follow_up" as const)
							: ("first_tour" as const),
					})),
				activities: activities.filter((a) => a.leadId === l.id),
			};
		}),
	};
}

const primaryPhone = sql<
	string | null
>`(select p.phone_e164 from contact_phone p where p.contact_id = ${contact.id} order by p.is_primary desc limit 1)`;

/** Name contains the query, or the query is one of the contact's phones. */
function contactSearch(query: string | undefined): SQL | undefined {
	const q = query?.trim();
	if (!q) return undefined;
	const phone = normalizePhone(q);
	return or(
		ilike(contact.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
		phone
			? sql`exists (select 1 from contact_phone p where p.contact_id = ${contact.id} and p.phone_e164 = ${phone})`
			: undefined,
	);
}

const withPhone = <T extends { primaryPhone: string | null }>(rows: T[]) =>
	rows.map((r) => ({
		...r,
		primaryPhone: r.primaryPhone ? formatPhone(r.primaryPhone) : null,
	}));

/** Lead pipeline list (vetting queue), newest first; search by name or phone. */
export async function listLeads(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listLeadsInput>,
) {
	const rows = await db
		.select({
			leadId: lead.id,
			contactId: contact.id,
			contactName: contact.name,
			projectName: project.name,
			status: lead.status,
			priority: lead.priority,
			ownerMemberId: lead.ownerMemberId,
			ownerName: ownerUser.name,
			nextFollowUpAt: lead.nextFollowUpAt,
			createdAt: lead.createdAt,
			primaryPhone,
		})
		.from(lead)
		.innerJoin(contact, eq(contact.id, lead.contactId))
		.innerJoin(project, eq(project.id, lead.projectId))
		.leftJoin(member, eq(member.id, lead.ownerMemberId))
		.leftJoin(ownerUser, eq(ownerUser.id, member.userId))
		.where(
			and(
				visibleLeadCondition(tenant),
				input.projectId ? eq(lead.projectId, input.projectId) : undefined,
				input.statuses?.length
					? inArray(lead.status, input.statuses)
					: undefined,
				input.ownership === "mine"
					? eq(lead.ownerMemberId, tenant.memberId)
					: undefined,
				input.ownership === "pool"
					? sql`${lead.ownerMemberId} is null`
					: undefined,
				contactSearch(input.query),
			),
		)
		.orderBy(desc(lead.priority), desc(lead.createdAt))
		.limit(200);
	return withPhone(rows);
}

/** Opportunity pipeline list, most recent visit first. */
export async function listOpportunities(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listOpportunitiesInput>,
) {
	const rows = await db
		.select({
			opportunityId: opportunity.id,
			contactId: contact.id,
			contactName: contact.name,
			projectName: project.name,
			status: opportunity.status,
			ownerMemberId: opportunity.ownerMemberId,
			ownerName: ownerUser.name,
			lastVisitAt: opportunity.lastVisitAt,
			nextFollowUpAt: opportunity.nextFollowUpAt,
			primaryPhone,
		})
		.from(opportunity)
		.innerJoin(contact, eq(contact.id, opportunity.contactId))
		.innerJoin(project, eq(project.id, opportunity.projectId))
		.leftJoin(member, eq(member.id, opportunity.ownerMemberId))
		.leftJoin(ownerUser, eq(ownerUser.id, member.userId))
		.where(
			and(
				visibleOpportunityCondition(tenant),
				input.projectId
					? eq(opportunity.projectId, input.projectId)
					: undefined,
				input.statuses?.length
					? inArray(opportunity.status, input.statuses)
					: undefined,
				input.ownership === "mine"
					? eq(opportunity.ownerMemberId, tenant.memberId)
					: undefined,
				contactSearch(input.query),
			),
		)
		.orderBy(desc(opportunity.lastVisitAt))
		.limit(200);
	return withPhone(rows);
}

export async function updateContact(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateContactInput>,
) {
	const { contactId, ...changes } = input;
	await db.transaction(async (tx) => {
		await requireContactAccess(tx, tenant, contactId);
		await tx.update(contact).set(changes).where(eq(contact.id, contactId));
		await writeAudit(tx, tenant, {
			action: "contact.update",
			entityType: "contact",
			entityId: contactId,
			after: { fields: Object.keys(changes) },
		});
	});
}

export async function addContactPhone(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof contactPhoneInput>,
) {
	const phone = normalizePhone(input.phone);
	if (!phone) badRequest("Invalid phone number");
	await db.transaction(async (tx) => {
		await requireContactAccess(tx, tenant, input.contactId);
		const [taken] = await tx
			.select({ contactId: contactPhone.contactId })
			.from(contactPhone)
			.where(
				and(
					eq(contactPhone.organizationId, tenant.organizationId),
					eq(contactPhone.phoneE164, phone),
				),
			);
		if (taken) {
			conflict(
				taken.contactId === input.contactId
					? "This contact already has this number"
					: "This number belongs to another contact",
			);
		}
		await tx.insert(contactPhone).values({
			organizationId: tenant.organizationId,
			contactId: input.contactId,
			phoneE164: phone,
		});
		await writeAudit(tx, tenant, {
			action: "contact.phone_add",
			entityType: "contact",
			entityId: input.contactId,
		});
	});
}

export async function removeContactPhone(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof contactPhoneInput>,
) {
	const phone = normalizePhone(input.phone) ?? input.phone;
	await db.transaction(async (tx) => {
		await requireContactAccess(tx, tenant, input.contactId);
		const phones = await tx
			.select({
				phoneE164: contactPhone.phoneE164,
				isPrimary: contactPhone.isPrimary,
			})
			.from(contactPhone)
			.where(eq(contactPhone.contactId, input.contactId));
		const target = phones.find((p) => p.phoneE164 === phone);
		if (!target) notFound("Phone");
		if (phones.length === 1)
			badRequest("A contact needs at least one phone number");
		await tx
			.delete(contactPhone)
			.where(
				and(
					eq(contactPhone.organizationId, tenant.organizationId),
					eq(contactPhone.phoneE164, phone),
				),
			);
		if (target.isPrimary) {
			const next = phones.find((p) => p.phoneE164 !== phone);
			if (next) {
				await tx
					.update(contactPhone)
					.set({ isPrimary: true })
					.where(
						and(
							eq(contactPhone.organizationId, tenant.organizationId),
							eq(contactPhone.phoneE164, next.phoneE164),
						),
					);
			}
		}
		await writeAudit(tx, tenant, {
			action: "contact.phone_remove",
			entityType: "contact",
			entityId: input.contactId,
		});
	});
}

/** Consent change with who and when (brief §10), audited. */
export async function setConsent(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof consentInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireContactAccess(tx, tenant, input.contactId);
		if (row.marketingConsent === input.marketingConsent) return;
		await tx
			.update(contact)
			.set({
				marketingConsent: input.marketingConsent,
				consentRecordedByUserId: tenant.userId,
				consentRecordedAt: new Date(),
			})
			.where(eq(contact.id, row.id));
		await writeAudit(tx, tenant, {
			action: "contact.consent_change",
			entityType: "contact",
			entityId: row.id,
			before: { marketingConsent: row.marketingConsent },
			after: { marketingConsent: input.marketingConsent },
		});
	});
}
