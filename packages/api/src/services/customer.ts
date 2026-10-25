import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	campaign,
	customer,
	customerPhone,
	lead,
	leadSource,
	leadStatuses,
	member,
	opportunity,
	opportunityStages,
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
import {
	canSeeLead,
	visibleLeadCondition,
	visibleOpportunityCondition,
} from "./lead-access";
import type { Tenant } from "./tenancy";

type Executor = Pick<Database, "select">;

export const phoneLookupInput = z.strictObject({
	phone: z.string().trim().max(40),
});
export const customerIdInput = z.strictObject({ customerId: z.uuid() });
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
	stages: z
		.array(z.enum(opportunityStages))
		.max(opportunityStages.length)
		.optional(),
	ownership: z.enum(["mine", "all"]).optional(),
});
export const updateCustomerInput = z.strictObject({
	customerId: z.uuid(),
	name: z.string().trim().min(1).max(120).optional(),
	lineId: z.string().trim().max(80).nullable().optional(),
	email: z.email().max(200).nullable().optional(),
});
export const customerPhoneInput = z.strictObject({
	customerId: z.uuid(),
	phone: z.string().trim().min(3).max(40),
});
export const consentInput = z.strictObject({
	customerId: z.uuid(),
	marketingConsent: z.boolean(),
});
export const referrerInput = z.strictObject({
	customerId: z.uuid(),
	referrerCustomerId: z.uuid().nullable(),
});

const ownerUser = aliasedTable(user, "owner_user");

/** The latest deal stage of the outer `lead` row (null until converted). */
const latestStage = sql<
	(typeof opportunityStages)[number] | null
>`(select o.stage from opportunity o where o.lead_id = ${sql.raw(`"lead"."id"`)} order by o.created_at desc limit 1)`;

/** Every lead of a customer, with project, owner and deal stage (no private fields). */
function leadSummaries(
	db: Executor,
	organizationId: string,
	customerIds: string[],
) {
	return db
		.select({
			id: lead.id,
			customerId: lead.customerId,
			projectId: lead.projectId,
			projectName: project.name,
			status: lead.status,
			stage: latestStage,
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
				inArray(lead.customerId, customerIds),
			),
		)
		.orderBy(asc(project.name));
}

/**
 * Duplicate check while typing (brief §6): the customer behind a phone, with a
 * summary line per project (project · status or deal stage · owner) — never
 * private details.
 */
export async function lookupByPhone(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof phoneLookupInput>,
) {
	const phone = normalizePhone(input.phone);
	if (!phone) return { phone: null, customer: null };
	const [match] = await db
		.select({ id: customer.id, name: customer.name })
		.from(customerPhone)
		.innerJoin(customer, eq(customer.id, customerPhone.customerId))
		.where(
			and(
				eq(customerPhone.organizationId, tenant.organizationId),
				eq(customerPhone.phoneE164, phone),
			),
		);
	if (!match) return { phone, customer: null };
	const leads = await leadSummaries(db, tenant.organizationId, [match.id]);
	return {
		phone,
		customer: {
			...match,
			leads: leads.map(
				({ projectId, projectName, status, stage, ownerName }) => ({
					projectId,
					projectName,
					status,
					stage,
					ownerName,
				}),
			),
		},
	};
}

/** The customer if the tenant may open their page: unscoped roles, or any visible lead. */
async function requireCustomerAccess(
	db: Executor,
	tenant: Tenant,
	customerId: string,
) {
	const [row] = await db
		.select()
		.from(customer)
		.where(
			and(
				eq(customer.id, customerId),
				eq(customer.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Customer");
	if (tenant.projectIds !== null) {
		const [visible] = await db
			.select({ id: lead.id })
			.from(lead)
			.where(and(eq(lead.customerId, customerId), visibleLeadCondition(tenant)))
			.limit(1);
		if (!visible) notFound("Customer");
	}
	return row;
}

/**
 * Customer page: shared profile; per visible project the lead (vetting) and
 * its latest deal, with one timeline; summary lines for the rest.
 */
export async function getCustomer(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof customerIdInput>,
) {
	const row = await requireCustomerAccess(db, tenant, input.customerId);
	const consentBy = aliasedTable(user, "consent_user");
	const [[consent], phones, summaries, [referrer]] = await Promise.all([
		db
			.select({ name: consentBy.name })
			.from(consentBy)
			.where(eq(consentBy.id, row.consentRecordedByUserId ?? "")),
		db
			.select({
				phoneE164: customerPhone.phoneE164,
				isPrimary: customerPhone.isPrimary,
			})
			.from(customerPhone)
			.where(eq(customerPhone.customerId, row.id))
			.orderBy(desc(customerPhone.isPrimary), asc(customerPhone.createdAt)),
		leadSummaries(db, tenant.organizationId, [row.id]),
		row.referredByCustomerId
			? db
					.select({ id: customer.id, name: customer.name })
					.from(customer)
					.where(eq(customer.id, row.referredByCustomerId))
			: Promise.resolve([]),
	]);

	const visibleIds = summaries
		.filter((s) => canSeeLead(tenant, s))
		.map((s) => s.id);
	const [details, deals, activities] = visibleIds.length
		? await Promise.all([
				db
					.select({
						lead,
						sourceName: leadSource.name,
						campaignName: campaign.name,
						campaignCode: campaign.code,
						minPriceSatang: sql<
							number | null
						>`(select min(u.list_price_satang)::float8 from unit u where u.project_id = ${lead.projectId} and u.status = 'available')`,
						maxPriceSatang: sql<
							number | null
						>`(select max(u.list_price_satang)::float8 from unit u where u.project_id = ${lead.projectId} and u.status = 'available')`,
					})
					.from(lead)
					.innerJoin(leadSource, eq(leadSource.id, lead.sourceId))
					.leftJoin(campaign, eq(campaign.id, lead.campaignId))
					.where(inArray(lead.id, visibleIds)),
				db
					.select()
					.from(opportunity)
					.where(inArray(opportunity.leadId, visibleIds))
					.orderBy(desc(opportunity.createdAt)),
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
		: [[], [], []];

	return {
		id: row.id,
		name: row.name,
		lineId: row.lineId,
		email: row.email,
		phones: phones.map((p) => ({ ...p, display: formatPhone(p.phoneE164) })),
		marketingConsent: row.marketingConsent,
		consentRecordedAt: row.consentRecordedAt,
		consentRecordedBy: consent?.name ?? null,
		referredBy: referrer ?? null,
		leads: summaries.map((s) => {
			const d = details.find((x) => x.lead.id === s.id);
			if (!d) {
				// Brief §4: other salespeople see only project · status · owner.
				return {
					visible: false as const,
					id: s.id,
					projectName: s.projectName,
					status: s.status,
					stage: s.stage,
					ownerName: s.ownerName,
				};
			}
			const l = d.lead;
			const deal = deals.find((o) => o.leadId === l.id) ?? null;
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
				qualifiedAt: l.qualifiedAt,
				convertedAt: l.convertedAt,
				nextFollowUpAt: l.nextFollowUpAt,
				contactDeadlineAt: l.contactDeadlineAt,
				projectMinPriceSatang: d.minPriceSatang,
				projectMaxPriceSatang: d.maxPriceSatang,
				createdAt: l.createdAt,
				opportunity: deal && {
					id: deal.id,
					stage: deal.stage,
					lostReason: deal.lostReason,
					ownerMemberId: deal.ownerMemberId,
					firstVisitAt: deal.firstVisitAt,
					lastVisitAt: deal.lastVisitAt,
					visitCount: deal.visitCount,
					nextFollowUpAt: deal.nextFollowUpAt,
				},
				activities: activities.filter((a) => a.leadId === l.id),
			};
		}),
	};
}

const primaryPhone = sql<
	string | null
>`(select p.phone_e164 from customer_phone p where p.customer_id = ${customer.id} order by p.is_primary desc limit 1)`;

/** Name contains the query, or the query is one of the customer's phones. */
function customerSearch(query: string | undefined): SQL | undefined {
	const q = query?.trim();
	if (!q) return undefined;
	const phone = normalizePhone(q);
	return or(
		ilike(customer.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
		phone
			? sql`exists (select 1 from customer_phone p where p.customer_id = ${customer.id} and p.phone_e164 = ${phone})`
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
			customerId: customer.id,
			customerName: customer.name,
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
		.innerJoin(customer, eq(customer.id, lead.customerId))
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
				customerSearch(input.query),
			),
		)
		.orderBy(desc(lead.priority), desc(lead.createdAt))
		.limit(200);
	return withPhone(rows);
}

/** Deal pipeline list, most recent visit first. */
export async function listOpportunities(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listOpportunitiesInput>,
) {
	const rows = await db
		.select({
			opportunityId: opportunity.id,
			customerId: customer.id,
			customerName: customer.name,
			projectName: project.name,
			stage: opportunity.stage,
			ownerMemberId: opportunity.ownerMemberId,
			ownerName: ownerUser.name,
			lastVisitAt: opportunity.lastVisitAt,
			nextFollowUpAt: opportunity.nextFollowUpAt,
			primaryPhone,
		})
		.from(opportunity)
		.innerJoin(customer, eq(customer.id, opportunity.customerId))
		.innerJoin(project, eq(project.id, opportunity.projectId))
		.leftJoin(member, eq(member.id, opportunity.ownerMemberId))
		.leftJoin(ownerUser, eq(ownerUser.id, member.userId))
		.where(
			and(
				visibleOpportunityCondition(tenant),
				input.projectId
					? eq(opportunity.projectId, input.projectId)
					: undefined,
				input.stages?.length
					? inArray(opportunity.stage, input.stages)
					: undefined,
				input.ownership === "mine"
					? eq(opportunity.ownerMemberId, tenant.memberId)
					: undefined,
				customerSearch(input.query),
			),
		)
		.orderBy(desc(opportunity.lastVisitAt))
		.limit(200);
	return withPhone(rows);
}

export async function updateCustomer(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateCustomerInput>,
) {
	const { customerId, ...changes } = input;
	await db.transaction(async (tx) => {
		await requireCustomerAccess(tx, tenant, customerId);
		await tx.update(customer).set(changes).where(eq(customer.id, customerId));
		await writeAudit(tx, tenant, {
			action: "customer.update",
			entityType: "customer",
			entityId: customerId,
			after: { fields: Object.keys(changes) },
		});
	});
}

export async function addCustomerPhone(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof customerPhoneInput>,
) {
	const phone = normalizePhone(input.phone);
	if (!phone) badRequest("Invalid phone number");
	await db.transaction(async (tx) => {
		await requireCustomerAccess(tx, tenant, input.customerId);
		const [taken] = await tx
			.select({ customerId: customerPhone.customerId })
			.from(customerPhone)
			.where(
				and(
					eq(customerPhone.organizationId, tenant.organizationId),
					eq(customerPhone.phoneE164, phone),
				),
			);
		if (taken) {
			conflict(
				taken.customerId === input.customerId
					? "This customer already has this number"
					: "This number belongs to another customer",
			);
		}
		await tx.insert(customerPhone).values({
			organizationId: tenant.organizationId,
			customerId: input.customerId,
			phoneE164: phone,
		});
		await writeAudit(tx, tenant, {
			action: "customer.phone_add",
			entityType: "customer",
			entityId: input.customerId,
		});
	});
}

export async function removeCustomerPhone(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof customerPhoneInput>,
) {
	const phone = normalizePhone(input.phone) ?? input.phone;
	await db.transaction(async (tx) => {
		await requireCustomerAccess(tx, tenant, input.customerId);
		const phones = await tx
			.select({
				phoneE164: customerPhone.phoneE164,
				isPrimary: customerPhone.isPrimary,
			})
			.from(customerPhone)
			.where(eq(customerPhone.customerId, input.customerId));
		const target = phones.find((p) => p.phoneE164 === phone);
		if (!target) notFound("Phone");
		if (phones.length === 1)
			badRequest("A customer needs at least one phone number");
		await tx
			.delete(customerPhone)
			.where(
				and(
					eq(customerPhone.organizationId, tenant.organizationId),
					eq(customerPhone.phoneE164, phone),
				),
			);
		if (target.isPrimary) {
			const next = phones.find((p) => p.phoneE164 !== phone);
			if (next) {
				await tx
					.update(customerPhone)
					.set({ isPrimary: true })
					.where(
						and(
							eq(customerPhone.organizationId, tenant.organizationId),
							eq(customerPhone.phoneE164, next.phoneE164),
						),
					);
			}
		}
		await writeAudit(tx, tenant, {
			action: "customer.phone_remove",
			entityType: "customer",
			entityId: input.customerId,
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
		const row = await requireCustomerAccess(tx, tenant, input.customerId);
		if (row.marketingConsent === input.marketingConsent) return;
		await tx
			.update(customer)
			.set({
				marketingConsent: input.marketingConsent,
				consentRecordedByUserId: tenant.userId,
				consentRecordedAt: new Date(),
			})
			.where(eq(customer.id, row.id));
		await writeAudit(tx, tenant, {
			action: "customer.consent_change",
			entityType: "customer",
			entityId: row.id,
			before: { marketingConsent: row.marketingConsent },
			after: { marketingConsent: input.marketingConsent },
		});
	});
}

export async function setReferrer(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof referrerInput>,
) {
	if (input.referrerCustomerId === input.customerId) {
		badRequest("A customer can't refer themselves");
	}
	await db.transaction(async (tx) => {
		await requireCustomerAccess(tx, tenant, input.customerId);
		if (input.referrerCustomerId) {
			const [ref] = await tx
				.select({ id: customer.id })
				.from(customer)
				.where(
					and(
						eq(customer.id, input.referrerCustomerId),
						eq(customer.organizationId, tenant.organizationId),
					),
				);
			if (!ref) notFound("Referrer");
		}
		await tx
			.update(customer)
			.set({ referredByCustomerId: input.referrerCustomerId })
			.where(eq(customer.id, input.customerId));
		await writeAudit(tx, tenant, {
			action: "customer.referrer_change",
			entityType: "customer",
			entityId: input.customerId,
			after: { referredByCustomerId: input.referrerCustomerId },
		});
	});
}
