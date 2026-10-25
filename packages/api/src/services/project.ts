import type { Database } from "@Real-Estate-CRM/db";
import {
	defaultQualificationRules,
	project,
	projectClosedDate,
	projectTypes,
	unit,
} from "@Real-Estate-CRM/db/schema/index";
import { and, arrayOverlaps, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { conflict, isUniqueViolation, notFound } from "./errors";
import { requireProject } from "./scope";
import type { Tenant } from "./tenancy";
import { isoDate, officeHours, tag, timeZone } from "./validation";

export const projectName = z.string().trim().min(1).max(120);

export const createProjectInput = z.strictObject({
	name: projectName,
	type: z.enum(projectTypes).optional(),
});
export const renameProjectInput = z.strictObject({
	projectId: z.uuid(),
	name: projectName,
});
export const projectIdInput = z.strictObject({ projectId: z.uuid() });

export const updateProjectInput = z.strictObject({
	projectId: z.uuid(),
	type: z.enum(projectTypes).optional(),
	timeZone: timeZone.optional(),
	officeHours: officeHours.optional(),
	/** Basis points: 150 = 1.50 %. */
	commissionBps: z.number().int().min(0).max(10_000).optional(),
	unitTags: z
		.array(tag)
		.max(100)
		.refine((tags) => new Set(tags).size === tags.length, "Duplicate tag")
		.optional(),
	/** Fit check (brief §6); missing keys keep their current value. */
	qualificationRules: z
		.strictObject({
			budgetTolerancePct: z.number().int().min(0).max(50).optional(),
			qualifyWithinMonths: z.number().int().min(1).max(36).optional(),
			autoQualify: z.boolean().optional(),
		})
		.optional(),
});

export const closedDateInput = z.strictObject({
	projectId: z.uuid(),
	date: isoDate,
	note: z.string().trim().max(120).optional(),
});
export const removeClosedDateInput = z.strictObject({
	projectId: z.uuid(),
	date: isoDate,
});

/** Min / max list price of available units, per project or unit type. */
export function availablePriceRange() {
	return {
		minPriceSatang: sql<number | null>`min(${unit.listPriceSatang})::float8`,
		maxPriceSatang: sql<number | null>`max(${unit.listPriceSatang})::float8`,
	};
}

/** Projects the tenant can see: their scope, or all for unscoped roles. */
export async function listProjects(db: Database, tenant: Tenant) {
	if (tenant.projectIds?.length === 0) return [];
	return db
		.select({ id: project.id, name: project.name, type: project.type })
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
				.values({
					organizationId: tenant.organizationId,
					name: input.name,
					type: input.type,
				})
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

/** Full project settings, closed dates and the available-unit price range. */
export async function getProject(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof projectIdInput>,
) {
	const row = await requireProject(db, tenant, input.projectId);
	const [closedDates, [range]] = await Promise.all([
		db
			.select({ date: projectClosedDate.date, note: projectClosedDate.note })
			.from(projectClosedDate)
			.where(eq(projectClosedDate.projectId, row.id))
			.orderBy(asc(projectClosedDate.date)),
		db
			.select(availablePriceRange())
			.from(unit)
			.where(and(eq(unit.projectId, row.id), eq(unit.status, "available"))),
	]);
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		timeZone: row.timeZone,
		officeHours: row.officeHours,
		commissionBps: row.commissionBps,
		unitTags: row.unitTags,
		qualificationRules: {
			...defaultQualificationRules,
			...row.qualificationRules,
		},
		closedDates,
		minPriceSatang: range?.minPriceSatang ?? null,
		maxPriceSatang: range?.maxPriceSatang ?? null,
	};
}

export async function updateProject(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateProjectInput>,
) {
	const { projectId, ...changes } = input;
	return db.transaction(async (tx) => {
		const before = await requireProject(tx, tenant, projectId);

		// A tag can only be removed from the project's list once no unit uses it.
		if (changes.unitTags) {
			const removed = before.unitTags.filter(
				(t) => !changes.unitTags?.includes(t),
			);
			if (removed.length > 0) {
				const [inUse] = await tx
					.select({ n: count() })
					.from(unit)
					.where(
						and(
							eq(unit.projectId, projectId),
							arrayOverlaps(unit.tags, removed),
						),
					);
				if (inUse && inUse.n > 0) {
					conflict(
						`Tags still used by ${inUse.n} units: ${removed.join(", ")}`,
					);
				}
			}
		}

		const set = {
			...changes,
			...(changes.qualificationRules && {
				qualificationRules: {
					...before.qualificationRules,
					...changes.qualificationRules,
				},
			}),
		};
		await tx.update(project).set(set).where(eq(project.id, projectId));
		const fields = Object.keys(changes) as (keyof typeof changes)[];
		await writeAudit(tx, tenant, {
			action: "project.update",
			entityType: "project",
			entityId: projectId,
			before: Object.fromEntries(fields.map((f) => [f, before[f]])),
			after: changes,
		});
	});
}

export async function addClosedDate(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof closedDateInput>,
) {
	await db.transaction(async (tx) => {
		await requireProject(tx, tenant, input.projectId);
		await tx
			.insert(projectClosedDate)
			.values({ organizationId: tenant.organizationId, ...input })
			.onConflictDoUpdate({
				target: [projectClosedDate.projectId, projectClosedDate.date],
				set: { note: input.note ?? null },
			});
		await writeAudit(tx, tenant, {
			action: "project.closed_date_add",
			entityType: "project",
			entityId: input.projectId,
			after: { date: input.date },
		});
	});
}

export async function removeClosedDate(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof removeClosedDateInput>,
) {
	await db.transaction(async (tx) => {
		await requireProject(tx, tenant, input.projectId);
		const removed = await tx
			.delete(projectClosedDate)
			.where(
				and(
					eq(projectClosedDate.projectId, input.projectId),
					eq(projectClosedDate.date, input.date),
				),
			)
			.returning({ date: projectClosedDate.date });
		if (removed.length === 0) notFound("Closed date");
		await writeAudit(tx, tenant, {
			action: "project.closed_date_remove",
			entityType: "project",
			entityId: input.projectId,
			before: { date: input.date },
		});
	});
}
