import type { Database } from "@Real-Estate-CRM/db";
import {
	member,
	project,
	projectMember,
	user,
} from "@Real-Estate-CRM/db/schema/index";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { notFound } from "./errors";
import type { Tenant } from "./tenancy";

export const projectScopeInput = z.strictObject({
	projectId: z.uuid(),
	memberId: z.string().min(1),
});
export const listProjectScopeInput = z.strictObject({ projectId: z.uuid() });

async function assertProject(db: Database, tenant: Tenant, projectId: string) {
	const [row] = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Project");
}

async function assertMember(db: Database, tenant: Tenant, memberId: string) {
	const [row] = await db
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.id, memberId),
				eq(member.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Member");
}

/** Members who cover a project. */
export async function listProjectScope(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listProjectScopeInput>,
) {
	await assertProject(db, tenant, input.projectId);
	return db
		.select({
			memberId: member.id,
			role: member.role,
			name: user.name,
			email: user.email,
		})
		.from(projectMember)
		.innerJoin(member, eq(member.id, projectMember.memberId))
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(projectMember.organizationId, tenant.organizationId),
				eq(projectMember.projectId, input.projectId),
			),
		)
		.orderBy(asc(user.name));
}

export async function assignProjectScope(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof projectScopeInput>,
) {
	await assertProject(db, tenant, input.projectId);
	await assertMember(db, tenant, input.memberId);
	await db.transaction(async (tx) => {
		const inserted = await tx
			.insert(projectMember)
			.values({ organizationId: tenant.organizationId, ...input })
			.onConflictDoNothing()
			.returning({ projectId: projectMember.projectId });
		if (inserted.length === 0) return;
		await writeAudit(tx, tenant, {
			action: "project_scope.assign",
			entityType: "member",
			entityId: input.memberId,
			after: { projectId: input.projectId },
		});
	});
}

export async function unassignProjectScope(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof projectScopeInput>,
) {
	await db.transaction(async (tx) => {
		const removed = await tx
			.delete(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, tenant.organizationId),
					eq(projectMember.projectId, input.projectId),
					eq(projectMember.memberId, input.memberId),
				),
			)
			.returning({ projectId: projectMember.projectId });
		if (removed.length === 0) notFound("Project scope");
		await writeAudit(tx, tenant, {
			action: "project_scope.unassign",
			entityType: "member",
			entityId: input.memberId,
			before: { projectId: input.projectId },
		});
	});
}
