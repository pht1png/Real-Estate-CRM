import type { Database } from "@Real-Estate-CRM/db";
import { interest } from "@Real-Estate-CRM/db/schema/index";
import { and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";

import { notFound } from "./errors";
import type { Tenant } from "./tenancy";

/**
 * Brief §4: an interest is private to its owner, managers covering the project
 * and executives (plus owners/admins). Salespeople also see the pool of their
 * projects. Everyone else gets a summary line only.
 */
export function canSeeInterest(
	tenant: Tenant,
	i: { projectId: string; ownerMemberId: string | null },
) {
	if (tenant.projectIds === null) return true;
	if (!tenant.projectIds.includes(i.projectId)) return false;
	if (tenant.role === "sales_manager") return true;
	return i.ownerMemberId === null || i.ownerMemberId === tenant.memberId;
}

/** The same rule as a SQL condition on `interest`, for lists. */
export function visibleInterestCondition(tenant: Tenant): SQL {
	const inOrg = eq(interest.organizationId, tenant.organizationId);
	if (tenant.projectIds === null) return inOrg;
	if (tenant.projectIds.length === 0) return sql`false`;
	const inScope = and(
		inOrg,
		inArray(interest.projectId, tenant.projectIds),
	) as SQL;
	if (tenant.role === "sales_manager") return inScope;
	return and(
		inScope,
		or(
			isNull(interest.ownerMemberId),
			eq(interest.ownerMemberId, tenant.memberId),
		),
	) as SQL;
}

/** The interest, if the tenant may see it in full; otherwise NOT_FOUND. */
export async function requireVisibleInterest(
	db: Pick<Database, "select">,
	tenant: Tenant,
	interestId: string,
) {
	const [row] = await db
		.select()
		.from(interest)
		.where(
			and(
				eq(interest.id, interestId),
				eq(interest.organizationId, tenant.organizationId),
			),
		);
	if (!row || !canSeeInterest(tenant, row)) notFound("Interest");
	return row;
}
