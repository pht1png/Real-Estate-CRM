import type { Database } from "@Real-Estate-CRM/db";
import {
	campaign,
	customer,
	customerPhone,
	interest,
	interestActivity,
	interestStages,
	leadSource,
	member,
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
	sql,
} from "drizzle-orm";
import { z } from "zod";

import { formatPhone, normalizePhone } from "../phone";
import { writeAudit } from "./audit";
import { badRequest, conflict, notFound } from "./errors";
import {
	canSeeInterest,
	requireVisibleInterest,
	visibleInterestCondition,
} from "./lead-access";
import type { Tenant } from "./tenancy";

type Executor = Pick<Database, "select">;

export const phoneLookupInput = z.strictObject({
	phone: z.string().trim().max(40),
});
export const customerIdInput = z.strictObject({ customerId: z.uuid() });
export const listLeadsInput = z.strictObject({
	query: z.string().trim().max(120).optional(),
	projectId: z.uuid().optional(),
	stages: z.array(z.enum(interestStages)).max(interestStages.length).optional(),
	ownership: z.enum(["mine", "pool", "all"]).optional(),
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
export const addNoteInput = z.strictObject({
	interestId: z.uuid(),
	note: z.string().trim().min(1).max(2000),
});

const ownerUser = aliasedTable(user, "owner_user");

/** Every interest of a customer, with project and owner names (no private fields). */
function interestSummaries(
	db: Executor,
	organizationId: string,
	customerIds: string[],
) {
	return db
		.select({
			id: interest.id,
			customerId: interest.customerId,
			projectId: interest.projectId,
			projectName: project.name,
			stage: interest.stage,
			ownerMemberId: interest.ownerMemberId,
			ownerName: ownerUser.name,
		})
		.from(interest)
		.innerJoin(project, eq(project.id, interest.projectId))
		.leftJoin(member, eq(member.id, interest.ownerMemberId))
		.leftJoin(ownerUser, eq(ownerUser.id, member.userId))
		.where(
			and(
				eq(interest.organizationId, organizationId),
				inArray(interest.customerId, customerIds),
			),
		)
		.orderBy(asc(project.name));
}

/**
 * Duplicate check while typing (brief §6): the customer behind a phone, with a
 * summary line per interest (project · stage · owner) — never private details.
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
	const interests = await interestSummaries(db, tenant.organizationId, [
		match.id,
	]);
	return {
		phone,
		customer: {
			...match,
			interests: interests.map(
				({ projectId, projectName, stage, ownerName }) => ({
					projectId,
					projectName,
					stage,
					ownerName,
				}),
			),
		},
	};
}

/** The customer if the tenant may open their page: unscoped roles, or any visible interest. */
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
			.select({ id: interest.id })
			.from(interest)
			.where(
				and(
					eq(interest.customerId, customerId),
					visibleInterestCondition(tenant),
				),
			)
			.limit(1);
		if (!visible) notFound("Customer");
	}
	return row;
}

/** Customer page: shared profile, full visible interests with timelines, summary lines for the rest. */
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
		interestSummaries(db, tenant.organizationId, [row.id]),
		row.referredByCustomerId
			? db
					.select({ id: customer.id, name: customer.name })
					.from(customer)
					.where(eq(customer.id, row.referredByCustomerId))
			: Promise.resolve([]),
	]);

	const visibleIds = summaries
		.filter((s) => canSeeInterest(tenant, s))
		.map((s) => s.id);
	const [details, activities] = visibleIds.length
		? await Promise.all([
				db
					.select({
						interest,
						sourceName: leadSource.name,
						campaignName: campaign.name,
						campaignCode: campaign.code,
						minPriceSatang: sql<
							number | null
						>`(select min(u.list_price_satang)::float8 from unit u where u.project_id = ${interest.projectId} and u.status = 'available')`,
						maxPriceSatang: sql<
							number | null
						>`(select max(u.list_price_satang)::float8 from unit u where u.project_id = ${interest.projectId} and u.status = 'available')`,
					})
					.from(interest)
					.innerJoin(leadSource, eq(leadSource.id, interest.sourceId))
					.leftJoin(campaign, eq(campaign.id, interest.campaignId))
					.where(inArray(interest.id, visibleIds)),
				db
					.select({
						id: interestActivity.id,
						interestId: interestActivity.interestId,
						type: interestActivity.type,
						at: interestActivity.at,
						note: interestActivity.note,
						byName: user.name,
						data: interestActivity.data,
					})
					.from(interestActivity)
					.leftJoin(user, eq(user.id, interestActivity.byUserId))
					.where(inArray(interestActivity.interestId, visibleIds))
					.orderBy(desc(interestActivity.at)),
			])
		: [[], []];

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
		interests: summaries.map((s) => {
			const d = details.find((x) => x.interest.id === s.id);
			if (!d) {
				// Brief §4: other salespeople see only project · stage · owner.
				return {
					visible: false as const,
					id: s.id,
					projectName: s.projectName,
					stage: s.stage,
					ownerName: s.ownerName,
				};
			}
			const i = d.interest;
			return {
				visible: true as const,
				id: i.id,
				projectId: i.projectId,
				projectName: s.projectName,
				stage: i.stage,
				ownerMemberId: i.ownerMemberId,
				ownerName: s.ownerName,
				sourceName: d.sourceName,
				campaignName: d.campaignName,
				campaignCode: d.campaignCode,
				priority: i.priority,
				prioritySignals: i.prioritySignals,
				budgetMinSatang: i.budgetMinSatang,
				budgetMaxSatang: i.budgetMaxSatang,
				buyingTimeline: i.buyingTimeline,
				nextFollowUpAt: i.nextFollowUpAt,
				contactDeadlineAt: i.contactDeadlineAt,
				projectMinPriceSatang: d.minPriceSatang,
				projectMaxPriceSatang: d.maxPriceSatang,
				createdAt: i.createdAt,
				activities: activities.filter((a) => a.interestId === i.id),
			};
		}),
	};
}

/** Leads the tenant can see, newest first; search by name or phone. */
export async function listLeads(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listLeadsInput>,
) {
	const q = input.query?.trim();
	const phone = q ? normalizePhone(q) : null;
	const rows = await db
		.select({
			interestId: interest.id,
			customerId: customer.id,
			customerName: customer.name,
			projectName: project.name,
			stage: interest.stage,
			priority: interest.priority,
			ownerMemberId: interest.ownerMemberId,
			ownerName: ownerUser.name,
			nextFollowUpAt: interest.nextFollowUpAt,
			createdAt: interest.createdAt,
			primaryPhone: sql<
				string | null
			>`(select p.phone_e164 from customer_phone p where p.customer_id = ${customer.id} order by p.is_primary desc limit 1)`,
		})
		.from(interest)
		.innerJoin(customer, eq(customer.id, interest.customerId))
		.innerJoin(project, eq(project.id, interest.projectId))
		.leftJoin(member, eq(member.id, interest.ownerMemberId))
		.leftJoin(ownerUser, eq(ownerUser.id, member.userId))
		.where(
			and(
				visibleInterestCondition(tenant),
				input.projectId ? eq(interest.projectId, input.projectId) : undefined,
				input.stages?.length
					? inArray(interest.stage, input.stages)
					: undefined,
				input.ownership === "mine"
					? eq(interest.ownerMemberId, tenant.memberId)
					: undefined,
				input.ownership === "pool"
					? sql`${interest.ownerMemberId} is null`
					: undefined,
				q
					? or(
							ilike(customer.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
							phone
								? sql`exists (select 1 from customer_phone p where p.customer_id = ${customer.id} and p.phone_e164 = ${phone})`
								: undefined,
						)
					: undefined,
			),
		)
		.orderBy(desc(interest.priority), desc(interest.createdAt))
		.limit(200);
	return rows.map((r) => ({
		...r,
		primaryPhone: r.primaryPhone ? formatPhone(r.primaryPhone) : null,
	}));
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

export async function addNote(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof addNoteInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleInterest(tx, tenant, input.interestId);
		await tx.insert(interestActivity).values({
			organizationId: tenant.organizationId,
			interestId: row.id,
			type: "note",
			byUserId: tenant.userId,
			note: input.note,
		});
	});
}
