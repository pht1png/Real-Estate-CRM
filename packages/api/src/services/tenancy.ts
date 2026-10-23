import {
	isRoleName,
	type RoleName,
	scopedRoles,
} from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import { member, projectMember } from "@Real-Estate-CRM/db/schema/index";
import { and, eq } from "drizzle-orm";

/**
 * Who is acting, resolved on the server from the session — never from client
 * input. `projectIds` is the member's scope; null means every project.
 */
export type Tenant = {
	organizationId: string;
	userId: string;
	memberId: string;
	role: RoleName;
	projectIds: string[] | null;
};

export async function loadTenant(
	db: Database,
	organizationId: string,
	userId: string,
): Promise<Tenant | null> {
	const [row] = await db
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(
			and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
		);
	if (!row || !isRoleName(row.role)) return null;

	const projectIds = scopedRoles.includes(row.role)
		? (
				await db
					.select({ projectId: projectMember.projectId })
					.from(projectMember)
					.where(
						and(
							eq(projectMember.organizationId, organizationId),
							eq(projectMember.memberId, row.id),
						),
					)
			).map((r) => r.projectId)
		: null;

	return {
		organizationId,
		userId,
		memberId: row.id,
		role: row.role,
		projectIds,
	};
}

/** Whether the tenant covers a project (scoped roles only see their projects). */
export function coversProject(tenant: Tenant, projectId: string) {
	return tenant.projectIds === null || tenant.projectIds.includes(projectId);
}
