import type { Database } from "@Real-Estate-CRM/db";
import { lead, opportunity } from "@Real-Estate-CRM/db/schema/index";
import { and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";

import { notFound } from "./errors";
import type { Tenant } from "./tenancy";

type Owned = { projectId: string; ownerMemberId: string | null };

/**
 * Brief §4: a lead or deal is private to its owner, managers covering the
 * project and executives (plus owners/admins). Salespeople also see the pool
 * of their projects. Everyone else gets a summary line only.
 */
export function canSeeLead(tenant: Tenant, row: Owned) {
	if (tenant.projectIds === null) return true;
	if (!tenant.projectIds.includes(row.projectId)) return false;
	if (tenant.role === "sales_manager") return true;
	return row.ownerMemberId === null || row.ownerMemberId === tenant.memberId;
}

/** Same rule for opportunities (always owned, so no pool). */
export const canSeeOpportunity = (tenant: Tenant, row: Owned) =>
	canSeeLead(tenant, row);

function visibleCondition(
	tenant: Tenant,
	table: typeof lead | typeof opportunity,
): SQL {
	const inOrg = eq(table.organizationId, tenant.organizationId);
	if (tenant.projectIds === null) return inOrg;
	if (tenant.projectIds.length === 0) return sql`false`;
	const inScope = and(
		inOrg,
		inArray(table.projectId, tenant.projectIds),
	) as SQL;
	if (tenant.role === "sales_manager") return inScope;
	return and(
		inScope,
		or(isNull(table.ownerMemberId), eq(table.ownerMemberId, tenant.memberId)),
	) as SQL;
}

/** The lead rule as a SQL condition, for lists. */
export const visibleLeadCondition = (tenant: Tenant) =>
	visibleCondition(tenant, lead);

/** The opportunity rule as a SQL condition, for lists. */
export const visibleOpportunityCondition = (tenant: Tenant) =>
	visibleCondition(tenant, opportunity);

/** The lead, if the tenant may see it in full; otherwise NOT_FOUND. */
export async function requireVisibleLead(
	db: Pick<Database, "select">,
	tenant: Tenant,
	leadId: string,
) {
	const [row] = await db
		.select()
		.from(lead)
		.where(
			and(eq(lead.id, leadId), eq(lead.organizationId, tenant.organizationId)),
		);
	if (!row || !canSeeLead(tenant, row)) notFound("Lead");
	return row;
}

/** The opportunity, if the tenant may see it in full; otherwise NOT_FOUND. */
export async function requireVisibleOpportunity(
	db: Pick<Database, "select">,
	tenant: Tenant,
	opportunityId: string,
) {
	const [row] = await db
		.select()
		.from(opportunity)
		.where(
			and(
				eq(opportunity.id, opportunityId),
				eq(opportunity.organizationId, tenant.organizationId),
			),
		);
	if (!row || !canSeeOpportunity(tenant, row)) notFound("Opportunity");
	return row;
}
