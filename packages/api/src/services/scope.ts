import type { Database } from "@Real-Estate-CRM/db";
import { project } from "@Real-Estate-CRM/db/schema/index";
import { and, eq } from "drizzle-orm";

import { notFound } from "./errors";
import { coversProject, type Tenant } from "./tenancy";

type Executor = Pick<Database, "select">;

/**
 * The project, if it belongs to the tenant's organization and is in their
 * scope. Anything else is NOT_FOUND, so other companies' ids reveal nothing.
 */
export async function requireProject(
	db: Executor,
	tenant: Tenant,
	projectId: string,
) {
	const [row] = await db
		.select()
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.organizationId, tenant.organizationId),
			),
		);
	if (!row || !coversProject(tenant, row.id)) notFound("Project");
	return row;
}
