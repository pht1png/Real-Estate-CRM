import type { Database } from "@Real-Estate-CRM/db";
import { unit, unitType } from "@Real-Estate-CRM/db/schema/index";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { FileUrls } from "../context";
import { writeAudit } from "./audit";
import { badRequest, conflict, isUniqueViolation, notFound } from "./errors";
import { requireProject } from "./scope";
import type { Tenant } from "./tenancy";

/** Storage keys for an organization's floor plans (see the upload route). */
export function floorPlanPrefix(organizationId: string) {
	return `orgs/${organizationId}/floor-plans/`;
}

const fields = {
	name: z.string().trim().min(1).max(80),
	bedrooms: z.number().int().min(0).max(20).nullable(),
	bathrooms: z.number().int().min(0).max(20).nullable(),
	usableAreaSqm: z.number().positive().max(100_000).multipleOf(0.01).nullable(),
	floorPlanKey: z.string().min(1).max(300).nullable(),
};

export const listUnitTypesInput = z.strictObject({ projectId: z.uuid() });
export const createUnitTypeInput = z.strictObject({
	projectId: z.uuid(),
	name: fields.name,
	bedrooms: fields.bedrooms.optional(),
	bathrooms: fields.bathrooms.optional(),
	usableAreaSqm: fields.usableAreaSqm.optional(),
	floorPlanKey: fields.floorPlanKey.optional(),
});
export const updateUnitTypeInput = z.strictObject({
	unitTypeId: z.uuid(),
	name: fields.name.optional(),
	bedrooms: fields.bedrooms.optional(),
	bathrooms: fields.bathrooms.optional(),
	usableAreaSqm: fields.usableAreaSqm.optional(),
	floorPlanKey: fields.floorPlanKey.optional(),
});
export const unitTypeIdInput = z.strictObject({ unitTypeId: z.uuid() });

function assertOwnFloorPlan(tenant: Tenant, key: string | null | undefined) {
	if (key && !key.startsWith(floorPlanPrefix(tenant.organizationId))) {
		badRequest("Unknown floor plan");
	}
}

async function requireUnitType(
	db: Pick<Database, "select">,
	tenant: Tenant,
	unitTypeId: string,
) {
	const [row] = await db
		.select()
		.from(unitType)
		.where(
			and(
				eq(unitType.id, unitTypeId),
				eq(unitType.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Unit type");
	await requireProject(db, tenant, row.projectId);
	return row;
}

/** Unit types with unit counts, available-unit price range and a signed floor plan URL. */
export async function listUnitTypes(
	db: Database,
	files: FileUrls,
	tenant: Tenant,
	input: z.infer<typeof listUnitTypesInput>,
) {
	await requireProject(db, tenant, input.projectId);
	const rows = await db
		.select({
			id: unitType.id,
			name: unitType.name,
			bedrooms: unitType.bedrooms,
			bathrooms: unitType.bathrooms,
			usableAreaSqm: unitType.usableAreaSqm,
			floorPlanKey: unitType.floorPlanKey,
			unitCount: count(unit.id),
			minPriceSatang: sql<
				number | null
			>`(min(${unit.listPriceSatang}) filter (where ${unit.status} = 'available'))::float8`,
			maxPriceSatang: sql<
				number | null
			>`(max(${unit.listPriceSatang}) filter (where ${unit.status} = 'available'))::float8`,
		})
		.from(unitType)
		.leftJoin(unit, eq(unit.unitTypeId, unitType.id))
		.where(eq(unitType.projectId, input.projectId))
		.groupBy(unitType.id)
		.orderBy(asc(unitType.name));
	return Promise.all(
		rows.map(async ({ floorPlanKey, ...row }) => ({
			...row,
			floorPlanKey,
			floorPlanUrl: floorPlanKey ? await files.url(floorPlanKey) : null,
		})),
	);
}

export async function createUnitType(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof createUnitTypeInput>,
) {
	assertOwnFloorPlan(tenant, input.floorPlanKey);
	try {
		return await db.transaction(async (tx) => {
			await requireProject(tx, tenant, input.projectId);
			const [created] = await tx
				.insert(unitType)
				.values({ organizationId: tenant.organizationId, ...input })
				.returning({ id: unitType.id });
			if (!created) throw new Error("insert returned no row");
			await writeAudit(tx, tenant, {
				action: "unit_type.create",
				entityType: "unit_type",
				entityId: created.id,
				after: { projectId: input.projectId },
			});
			return created;
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A unit type with this name exists");
		throw error;
	}
}

export async function updateUnitType(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateUnitTypeInput>,
) {
	const { unitTypeId, ...changes } = input;
	assertOwnFloorPlan(tenant, changes.floorPlanKey);
	try {
		await db.transaction(async (tx) => {
			await requireUnitType(tx, tenant, unitTypeId);
			await tx.update(unitType).set(changes).where(eq(unitType.id, unitTypeId));
			await writeAudit(tx, tenant, {
				action: "unit_type.update",
				entityType: "unit_type",
				entityId: unitTypeId,
				after: { fields: Object.keys(changes) },
			});
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A unit type with this name exists");
		throw error;
	}
}

export async function deleteUnitType(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof unitTypeIdInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireUnitType(tx, tenant, input.unitTypeId);
		const [used] = await tx
			.select({ n: count() })
			.from(unit)
			.where(eq(unit.unitTypeId, row.id));
		if (used && used.n > 0) conflict("Unit type is used by units");
		await tx.delete(unitType).where(eq(unitType.id, row.id));
		await writeAudit(tx, tenant, {
			action: "unit_type.delete",
			entityType: "unit_type",
			entityId: row.id,
			before: { projectId: row.projectId },
		});
	});
}
