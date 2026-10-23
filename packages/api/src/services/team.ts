import type { Database } from "@Real-Estate-CRM/db";
import { member, projectMember, user } from "@Real-Estate-CRM/db/schema/index";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { Tenant } from "./tenancy";

/**
 * Members the tenant manages: everyone for unscoped roles, otherwise members
 * covering at least one of the tenant's projects. Each with their project ids.
 */
export async function listMembersInScope(db: Database, tenant: Tenant) {
	if (tenant.projectIds?.length === 0) return [];

	const scopes = await db
		.select({
			memberId: projectMember.memberId,
			projectId: projectMember.projectId,
		})
		.from(projectMember)
		.where(eq(projectMember.organizationId, tenant.organizationId));

	const projectsByMember = new Map<string, string[]>();
	for (const { memberId, projectId } of scopes) {
		projectsByMember.set(memberId, [
			...(projectsByMember.get(memberId) ?? []),
			projectId,
		]);
	}

	const visibleMemberIds = tenant.projectIds
		? [...projectsByMember]
				.filter(([, projectIds]) =>
					projectIds.some((id) => tenant.projectIds?.includes(id)),
				)
				.map(([memberId]) => memberId)
		: null;
	if (visibleMemberIds?.length === 0) return [];

	const rows = await db
		.select({
			memberId: member.id,
			role: member.role,
			name: user.name,
			email: user.email,
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(member.organizationId, tenant.organizationId),
				visibleMemberIds ? inArray(member.id, visibleMemberIds) : undefined,
			),
		)
		.orderBy(asc(user.name));

	return rows.map((row) => ({
		...row,
		projectIds: projectsByMember.get(row.memberId) ?? [],
	}));
}
