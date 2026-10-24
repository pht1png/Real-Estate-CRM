import type { Database } from "@Real-Estate-CRM/db";
import { section, sectionKinds, unit } from "@Real-Estate-CRM/db/schema/index";
import { and, asc, count, eq, max } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { conflict, isUniqueViolation, notFound } from "./errors";
import { requireProject } from "./scope";
import type { Tenant } from "./tenancy";

const sectionName = z.string().trim().min(1).max(80);

export const listSectionsInput = z.strictObject({ projectId: z.uuid() });
export const createSectionInput = z.strictObject({
	projectId: z.uuid(),
	kind: z.enum(sectionKinds),
	name: sectionName,
});
export const updateSectionInput = z.strictObject({
	sectionId: z.uuid(),
	kind: z.enum(sectionKinds).optional(),
	name: sectionName.optional(),
});
export const moveSectionInput = z.strictObject({
	sectionId: z.uuid(),
	direction: z.enum(["up", "down"]),
});
export const sectionIdInput = z.strictObject({ sectionId: z.uuid() });

type Executor = Pick<Database, "select">;

/** The section, if its project is in the tenant's organization and scope. */
async function requireSection(db: Executor, tenant: Tenant, sectionId: string) {
	const [row] = await db
		.select()
		.from(section)
		.where(
			and(
				eq(section.id, sectionId),
				eq(section.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Section");
	await requireProject(db, tenant, row.projectId);
	return row;
}

export async function listSections(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listSectionsInput>,
) {
	await requireProject(db, tenant, input.projectId);
	return db
		.select({
			id: section.id,
			kind: section.kind,
			name: section.name,
			sortOrder: section.sortOrder,
			unitCount: count(unit.id),
		})
		.from(section)
		.leftJoin(unit, eq(unit.sectionId, section.id))
		.where(eq(section.projectId, input.projectId))
		.groupBy(section.id)
		.orderBy(asc(section.sortOrder), asc(section.name));
}

/** Inserts a section at the end of the project's order (no audit; callers audit). */
export async function insertSection(
	tx: Pick<Database, "select" | "insert">,
	tenant: Tenant,
	input: z.infer<typeof createSectionInput>,
) {
	const [last] = await tx
		.select({ max: max(section.sortOrder) })
		.from(section)
		.where(eq(section.projectId, input.projectId));
	const [created] = await tx
		.insert(section)
		.values({
			organizationId: tenant.organizationId,
			...input,
			sortOrder: (last?.max ?? -1) + 1,
		})
		.returning();
	if (!created) throw new Error("insert returned no row");
	return created;
}

export async function createSection(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof createSectionInput>,
) {
	try {
		return await db.transaction(async (tx) => {
			await requireProject(tx, tenant, input.projectId);
			const created = await insertSection(tx, tenant, input);
			await writeAudit(tx, tenant, {
				action: "section.create",
				entityType: "section",
				entityId: created.id,
				after: { projectId: input.projectId, kind: input.kind },
			});
			return { id: created.id };
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A section with this name exists");
		throw error;
	}
}

export async function updateSection(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateSectionInput>,
) {
	const { sectionId, ...changes } = input;
	try {
		await db.transaction(async (tx) => {
			const before = await requireSection(tx, tenant, sectionId);
			await tx.update(section).set(changes).where(eq(section.id, sectionId));
			await writeAudit(tx, tenant, {
				action: "section.update",
				entityType: "section",
				entityId: sectionId,
				before: { kind: before.kind },
				after: { kind: changes.kind ?? before.kind },
			});
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A section with this name exists");
		throw error;
	}
}

/** Swaps the section with its neighbour in display order. */
export async function moveSection(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof moveSectionInput>,
) {
	await db.transaction(async (tx) => {
		const current = await requireSection(tx, tenant, input.sectionId);
		const siblings = await tx
			.select({ id: section.id })
			.from(section)
			.where(eq(section.projectId, current.projectId))
			.orderBy(asc(section.sortOrder), asc(section.name));
		const index = siblings.findIndex((s) => s.id === current.id);
		const target = index + (input.direction === "up" ? -1 : 1);
		const neighbour = siblings[target];
		if (!neighbour) return;
		// Renumber densely so equal sort orders can't get stuck.
		const order = siblings.map((s) => s.id);
		order[index] = neighbour.id;
		order[target] = current.id;
		for (const [i, id] of order.entries()) {
			await tx.update(section).set({ sortOrder: i }).where(eq(section.id, id));
		}
	});
}

export async function deleteSection(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof sectionIdInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireSection(tx, tenant, input.sectionId);
		const [used] = await tx
			.select({ n: count() })
			.from(unit)
			.where(eq(unit.sectionId, row.id));
		if (used && used.n > 0) conflict("Section still has units");
		await tx.delete(section).where(eq(section.id, row.id));
		await writeAudit(tx, tenant, {
			action: "section.delete",
			entityType: "section",
			entityId: row.id,
			before: { projectId: row.projectId },
		});
	});
}
