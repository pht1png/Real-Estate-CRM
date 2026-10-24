import type { Database } from "@Real-Estate-CRM/db";
import {
	facings,
	section,
	unit,
	unitPriceHistory,
	unitStatuses,
	unitType,
	user,
} from "@Real-Estate-CRM/db/schema/index";
import {
	and,
	arrayOverlaps,
	asc,
	desc,
	eq,
	gte,
	inArray,
	lte,
	sql,
} from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { badRequest, conflict, notFound } from "./errors";
import { requireProject } from "./scope";
import type { Tenant } from "./tenancy";
import { satang } from "./validation";

export const unitGridInput = z.strictObject({
	projectId: z.uuid(),
	statuses: z.array(z.enum(unitStatuses)).max(5).optional(),
	unitTypeIds: z.array(z.uuid()).max(100).optional(),
	facings: z.array(z.enum(facings)).max(8).optional(),
	tags: z.array(z.string().min(1)).max(50).optional(),
	minPriceSatang: satang.optional(),
	maxPriceSatang: satang.optional(),
});
export const unitIdInput = z.strictObject({ unitId: z.uuid() });
export const updateUnitPriceInput = z.strictObject({
	unitId: z.uuid(),
	newPriceSatang: satang,
	reason: z.string().trim().min(3).max(300),
});

/** Units of a project for the grid, with section and type names; filters combine with AND. */
export async function unitGrid(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof unitGridInput>,
) {
	await requireProject(db, tenant, input.projectId);
	const [sections, units] = await Promise.all([
		db
			.select({
				id: section.id,
				name: section.name,
				kind: section.kind,
				sortOrder: section.sortOrder,
			})
			.from(section)
			.where(eq(section.projectId, input.projectId))
			.orderBy(asc(section.sortOrder), asc(section.name)),
		db
			.select({
				id: unit.id,
				sectionId: unit.sectionId,
				floor: unit.floor,
				unitNumber: unit.unitNumber,
				unitTypeId: unit.unitTypeId,
				unitTypeName: unitType.name,
				landSizeSqwah: unit.landSizeSqwah,
				usableAreaSqm: sql<
					number | null
				>`coalesce(${unit.usableAreaSqm}, ${unitType.usableAreaSqm})::float8`,
				facing: unit.facing,
				tags: unit.tags,
				listPriceSatang: unit.listPriceSatang,
				status: unit.status,
			})
			.from(unit)
			.innerJoin(unitType, eq(unitType.id, unit.unitTypeId))
			.where(
				and(
					eq(unit.projectId, input.projectId),
					input.statuses?.length
						? inArray(unit.status, input.statuses)
						: undefined,
					input.unitTypeIds?.length
						? inArray(unit.unitTypeId, input.unitTypeIds)
						: undefined,
					input.facings?.length
						? inArray(unit.facing, input.facings)
						: undefined,
					input.tags?.length ? arrayOverlaps(unit.tags, input.tags) : undefined,
					input.minPriceSatang
						? gte(unit.listPriceSatang, input.minPriceSatang)
						: undefined,
					input.maxPriceSatang
						? lte(unit.listPriceSatang, input.maxPriceSatang)
						: undefined,
				),
			)
			// Top floors first; unit numbers in natural order (2 before 10).
			.orderBy(
				sql`${unit.floor} desc nulls last`,
				sql`length(${unit.unitNumber})`,
				asc(unit.unitNumber),
			),
	]);
	return { sections, units };
}

/** Locks the unit row for the rest of the transaction (concurrent edits queue up). */
async function lockUnit(
	tx: Pick<Database, "select">,
	tenant: Tenant,
	unitId: string,
) {
	const [row] = await tx
		.select()
		.from(unit)
		.where(
			and(eq(unit.id, unitId), eq(unit.organizationId, tenant.organizationId)),
		)
		.for("update");
	if (!row) notFound("Unit");
	await requireProject(tx, tenant, row.projectId);
	return row;
}

export async function unitPriceHistoryList(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof unitIdInput>,
) {
	const [row] = await db
		.select({ projectId: unit.projectId })
		.from(unit)
		.where(
			and(
				eq(unit.id, input.unitId),
				eq(unit.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Unit");
	await requireProject(db, tenant, row.projectId);
	return db
		.select({
			id: unitPriceHistory.id,
			oldPriceSatang: unitPriceHistory.oldPriceSatang,
			newPriceSatang: unitPriceHistory.newPriceSatang,
			reason: unitPriceHistory.reason,
			changedAt: unitPriceHistory.changedAt,
			changedBy: user.name,
		})
		.from(unitPriceHistory)
		.leftJoin(user, eq(user.id, unitPriceHistory.changedByUserId))
		.where(eq(unitPriceHistory.unitId, input.unitId))
		.orderBy(desc(unitPriceHistory.changedAt));
}

/**
 * Manager price edit (brief §6): only for units not yet deposited, always with
 * a reason; the old price goes into the history. Existing deposits keep their
 * own copy of the price (M6).
 */
export async function updateUnitPrice(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateUnitPriceInput>,
) {
	await db.transaction(async (tx) => {
		const row = await lockUnit(tx, tenant, input.unitId);
		if (row.status !== "available" && row.status !== "blocked") {
			conflict("Only available or blocked units can change price");
		}
		if (row.listPriceSatang === input.newPriceSatang) {
			badRequest("The price is unchanged");
		}
		await tx
			.update(unit)
			.set({ listPriceSatang: input.newPriceSatang })
			.where(eq(unit.id, row.id));
		await tx.insert(unitPriceHistory).values({
			organizationId: tenant.organizationId,
			unitId: row.id,
			oldPriceSatang: row.listPriceSatang,
			newPriceSatang: input.newPriceSatang,
			changedByUserId: tenant.userId,
			// Time of the change itself (after the row lock), not the transaction start,
			// so concurrent edits are listed in the order they were applied.
			changedAt: sql`clock_timestamp()`,
			reason: input.reason,
		});
		await writeAudit(tx, tenant, {
			action: "unit.price_change",
			entityType: "unit",
			entityId: row.id,
			before: { listPriceSatang: row.listPriceSatang },
			after: { listPriceSatang: input.newPriceSatang },
		});
	});
}

async function setStatus(
	db: Database,
	tenant: Tenant,
	unitId: string,
	from: "available" | "blocked",
	to: "available" | "blocked",
) {
	await db.transaction(async (tx) => {
		const row = await lockUnit(tx, tenant, unitId);
		if (row.status !== from) conflict(`Unit is ${row.status}, not ${from}`);
		await tx.update(unit).set({ status: to }).where(eq(unit.id, row.id));
		await writeAudit(tx, tenant, {
			action: to === "blocked" ? "unit.block" : "unit.unblock",
			entityType: "unit",
			entityId: row.id,
			before: { status: from },
			after: { status: to },
		});
	});
}

export const blockUnit = (
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof unitIdInput>,
) => setStatus(db, tenant, input.unitId, "available", "blocked");

export const unblockUnit = (
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof unitIdInput>,
) => setStatus(db, tenant, input.unitId, "blocked", "available");
