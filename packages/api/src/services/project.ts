import type { Database } from "@Real-Estate-CRM/db";
import { project } from "@Real-Estate-CRM/db/schema/index";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { conflict, isUniqueViolation, notFound } from "./errors";
import type { Tenant } from "./tenancy";

export const projectName = z.string().trim().min(1).max(120);

export const createProjectInput = z.strictObject({ name: projectName });
export const renameProjectInput = z.strictObject({
	projectId: z.uuid(),
	name: projectName,
});

/** Projects the tenant can see: their scope, or all for unscoped roles. */
export async function listProjects(db: Database, tenant: Tenant) {
	if (tenant.projectIds?.length === 0) return [];
	return db
		.select({ id: project.id, name: project.name })
		.from(project)
		.where(
			and(
				eq(project.organizationId, tenant.organizationId),
				tenant.projectIds ? inArray(project.id, tenant.projectIds) : undefined,
			),
		)
		.orderBy(asc(project.name));
}

export async function createProject(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof createProjectInput>,
) {
	try {
		return await db.transaction(async (tx) => {
			const [created] = await tx
				.insert(project)
				.values({ organizationId: tenant.organizationId, name: input.name })
				.returning({ id: project.id, name: project.name });
			if (!created) throw new Error("insert returned no row");
			await writeAudit(tx, tenant, {
				action: "project.create",
				entityType: "project",
				entityId: created.id,
			});
			return created;
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A project with this name exists");
		throw error;
	}
}

export async function renameProject(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof renameProjectInput>,
) {
	try {
		return await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(project)
				.set({ name: input.name })
				.where(
					and(
						eq(project.id, input.projectId),
						eq(project.organizationId, tenant.organizationId),
					),
				)
				.returning({ id: project.id, name: project.name });
			if (!updated) notFound("Project");
			await writeAudit(tx, tenant, {
				action: "project.rename",
				entityType: "project",
				entityId: updated.id,
			});
			return updated;
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A project with this name exists");
		throw error;
	}
}
