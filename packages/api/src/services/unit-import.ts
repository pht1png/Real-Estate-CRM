import type { Database } from "@Real-Estate-CRM/db";
import {
	type Facing,
	project,
	section,
	unit,
	unitType,
} from "@Real-Estate-CRM/db/schema/index";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { csvCell, parseCsv } from "./csv";
import { badRequest } from "./errors";
import { requireProject } from "./scope";
import { insertSection } from "./section";
import type { Tenant } from "./tenancy";

export const MAX_IMPORT_ROWS = 5000;

export const unitImportInput = z.strictObject({
	projectId: z.uuid(),
	/** CSV text; the browser decodes UTF-8 or Windows-874 before sending. */
	csv: z.string().min(1).max(3_000_000),
});

type Column =
	| "section"
	| "floor"
	| "unitNumber"
	| "unitType"
	| "landSizeSqwah"
	| "usableAreaSqm"
	| "facing"
	| "tags"
	| "listPrice";

const REQUIRED: Column[] = ["section", "unitNumber", "unitType", "listPrice"];

/** Header aliases (English and Thai), compared after `normalizeHeader`. */
const HEADER_ALIASES: Record<Column, string[]> = {
	section: [
		"section",
		"building",
		"phase",
		"zone",
		"ส่วน",
		"อาคาร",
		"ตึก",
		"เฟส",
		"โซน",
	],
	floor: ["floor", "ชั้น"],
	unitNumber: [
		"unitnumber",
		"unitno",
		"unit",
		"houseno",
		"room",
		"roomno",
		"plot",
		"เลขที่",
		"เลขที่ยูนิต",
		"บ้านเลขที่",
		"เลขห้อง",
		"ห้อง",
		"ยูนิต",
		"แปลง",
	],
	unitType: ["unittype", "type", "model", "แบบ", "แบบบ้าน", "แบบห้อง", "ประเภท"],
	landSizeSqwah: [
		"landsize",
		"landsizesqwah",
		"land",
		"sqwah",
		"ที่ดิน",
		"ที่ดินตรว",
		"ขนาดที่ดิน",
		"ขนาดที่ดินตรว",
	],
	usableAreaSqm: [
		"usablearea",
		"usableareasqm",
		"area",
		"sqm",
		"m2",
		"พื้นที่ใช้สอย",
		"พื้นที่ใช้สอยตรม",
		"พื้นที่",
		"ตรม",
	],
	facing: [
		"facing",
		"direction",
		"ทิศ",
		"ทิศหน้าบ้าน",
		"ทิศทาง",
		"หันหน้า",
		"หันหน้าทิศ",
	],
	tags: ["tags", "tag", "แท็ก", "ป้าย"],
	listPrice: [
		"listprice",
		"price",
		"listpricebaht",
		"pricebaht",
		"ราคา",
		"ราคาขาย",
		"ราคาบาท",
		"ราคาขายบาท",
	],
};

const FACING_ALIASES: Record<string, Facing> = {
	N: "N",
	NORTH: "N",
	เหนือ: "N",
	NE: "NE",
	NORTHEAST: "NE",
	ตะวันออกเฉียงเหนือ: "NE",
	E: "E",
	EAST: "E",
	ตะวันออก: "E",
	SE: "SE",
	SOUTHEAST: "SE",
	ตะวันออกเฉียงใต้: "SE",
	S: "S",
	SOUTH: "S",
	ใต้: "S",
	SW: "SW",
	SOUTHWEST: "SW",
	ตะวันตกเฉียงใต้: "SW",
	W: "W",
	WEST: "W",
	ตะวันตก: "W",
	NW: "NW",
	NORTHWEST: "NW",
	ตะวันตกเฉียงเหนือ: "NW",
};

const normalizeHeader = (s: string) =>
	s.toLowerCase().replace(/[\s_\-()./²]/g, "");
const key = (s: string) => s.trim().toLowerCase();

export type RowError = {
	field: Column | "row";
	code:
		| "required"
		| "invalid_integer"
		| "invalid_number"
		| "invalid_price"
		| "invalid_facing"
		| "too_long"
		| "duplicate_in_file"
		| "already_exists";
};

export type ImportRow = {
	line: number;
	section: string;
	floor: number | null;
	unitNumber: string;
	unitType: string;
	landSizeSqwah: number | null;
	usableAreaSqm: number | null;
	facing: Facing | null;
	tags: string[];
	listPriceSatang: number | null;
	errors: RowError[];
};

function parseDecimal(raw: string) {
	const cleaned = raw.replace(/[,\s฿]|บาท/g, "");
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
	return Number(cleaned);
}

/** Parses and validates the file against the project's current sections, types and units. */
export async function previewUnitImport(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof unitImportInput>,
) {
	const proj = await requireProject(db, tenant, input.projectId);
	const [header = [], ...body] = parseCsv(input.csv);

	const columns = new Map<Column, number>();
	const unknownHeaders: string[] = [];
	header.forEach((h, i) => {
		const n = normalizeHeader(h);
		const col = (Object.keys(HEADER_ALIASES) as Column[]).find((c) =>
			HEADER_ALIASES[c].includes(n),
		);
		if (col && !columns.has(col)) columns.set(col, i);
		else if (h.trim()) unknownHeaders.push(h.trim());
	});
	const missingColumns = REQUIRED.filter((c) => !columns.has(c));

	const nonEmpty = body
		.map((cells, i) => ({ cells, line: i + 2 }))
		.filter(({ cells }) => cells.some((c) => c.trim() !== ""));
	if (nonEmpty.length > MAX_IMPORT_ROWS) {
		badRequest(`At most ${MAX_IMPORT_ROWS} rows per import`);
	}

	const [sections, types] = await Promise.all([
		db
			.select({ id: section.id, name: section.name })
			.from(section)
			.where(eq(section.projectId, proj.id)),
		db
			.select({ id: unitType.id, name: unitType.name })
			.from(unitType)
			.where(eq(unitType.projectId, proj.id)),
	]);
	const sectionByKey = new Map(sections.map((s) => [key(s.name), s]));
	const typeByKey = new Map(types.map((t) => [key(t.name), t]));
	const existingUnits =
		sections.length > 0
			? await db
					.select({ sectionId: unit.sectionId, unitNumber: unit.unitNumber })
					.from(unit)
					.where(
						inArray(
							unit.sectionId,
							sections.map((s) => s.id),
						),
					)
			: [];
	const existing = new Set(
		existingUnits.map((u) => `${u.sectionId}|${key(u.unitNumber)}`),
	);

	const get = (cells: string[], col: Column) => {
		const i = columns.get(col);
		return i === undefined ? "" : (cells[i] ?? "").trim();
	};
	const seen = new Set<string>();
	const rows: ImportRow[] = nonEmpty.map(({ cells, line }) => {
		const errors: RowError[] = [];
		const text = (col: Column, max: number) => {
			const v = get(cells, col);
			if (v.length > max) errors.push({ field: col, code: "too_long" });
			return v.slice(0, max);
		};
		const sectionName = text("section", 80);
		const unitNumber = text("unitNumber", 40);
		const typeName = text("unitType", 80);
		for (const [col, v] of [
			["section", sectionName],
			["unitNumber", unitNumber],
			["unitType", typeName],
		] as const) {
			if (!v) errors.push({ field: col, code: "required" });
		}

		const floorRaw = get(cells, "floor");
		let floor: number | null = null;
		if (floorRaw) {
			floor = /^\d{1,3}$/.test(floorRaw) ? Number(floorRaw) : null;
			if (floor === null || floor < 1) {
				errors.push({ field: "floor", code: "invalid_integer" });
				floor = null;
			}
		}

		const decimal = (col: "landSizeSqwah" | "usableAreaSqm") => {
			const raw = get(cells, col);
			if (!raw) return null;
			const n = parseDecimal(raw);
			if (n === null || n <= 0)
				errors.push({ field: col, code: "invalid_number" });
			return n && n > 0 ? n : null;
		};
		const landSizeSqwah = decimal("landSizeSqwah");
		const usableAreaSqm = decimal("usableAreaSqm");

		const facingRaw = get(cells, "facing");
		const facing = facingRaw
			? (FACING_ALIASES[facingRaw.toUpperCase().replace(/[\s\-.]/g, "")] ??
				null)
			: null;
		if (facingRaw && !facing)
			errors.push({ field: "facing", code: "invalid_facing" });

		const tags = [
			...new Set(
				get(cells, "tags")
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
			),
		];
		if (tags.some((t) => t.length > 40))
			errors.push({ field: "tags", code: "too_long" });

		const priceRaw = get(cells, "listPrice");
		const price = priceRaw ? parseDecimal(priceRaw) : null;
		const listPriceSatang = price && price > 0 ? Math.round(price * 100) : null;
		if (!priceRaw) errors.push({ field: "listPrice", code: "required" });
		else if (listPriceSatang === null) {
			errors.push({ field: "listPrice", code: "invalid_price" });
		}

		if (sectionName && unitNumber) {
			const id = `${key(sectionName)}|${key(unitNumber)}`;
			if (seen.has(id))
				errors.push({ field: "row", code: "duplicate_in_file" });
			seen.add(id);
			const known = sectionByKey.get(key(sectionName));
			if (known && existing.has(`${known.id}|${key(unitNumber)}`)) {
				errors.push({ field: "row", code: "already_exists" });
			}
		}

		return {
			line,
			section: sectionByKey.get(key(sectionName))?.name ?? sectionName,
			floor,
			unitNumber,
			unitType: typeByKey.get(key(typeName))?.name ?? typeName,
			landSizeSqwah,
			usableAreaSqm,
			facing,
			tags,
			listPriceSatang,
			errors,
		};
	});

	const valid = rows.filter((r) => r.errors.length === 0);
	const distinctNew = (values: string[], known: Map<string, unknown>) => [
		...new Map(
			values.filter((v) => !known.has(key(v))).map((v) => [key(v), v]),
		).values(),
	];
	return {
		missingColumns,
		unknownHeaders,
		rows,
		validCount: valid.length,
		errorCount: rows.length - valid.length,
		newSections: distinctNew(
			valid.map((r) => r.section),
			sectionByKey,
		),
		newUnitTypes: distinctNew(
			valid.map((r) => r.unitType),
			typeByKey,
		),
		newTags: [...new Set(valid.flatMap((r) => r.tags))].filter(
			(t) => !proj.unitTags.includes(t),
		),
	};
}

/**
 * Imports the valid rows in one transaction (the file is validated again on the
 * server). Missing sections, unit types and tags are created; rows with errors,
 * including units that already exist, are skipped.
 */
export async function commitUnitImport(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof unitImportInput>,
) {
	const preview = await previewUnitImport(db, tenant, input);
	if (preview.missingColumns.length > 0) {
		badRequest(`Missing columns: ${preview.missingColumns.join(", ")}`);
	}
	const rows = preview.rows.filter((r) => r.errors.length === 0);
	if (rows.length === 0) badRequest("No valid rows to import");

	return db.transaction(async (tx) => {
		const proj = await requireProject(tx, tenant, input.projectId);
		const kind = proj.type === "condo" ? "building" : "phase";

		const sectionIds = new Map(
			(
				await tx
					.select({ id: section.id, name: section.name })
					.from(section)
					.where(eq(section.projectId, proj.id))
			).map((s) => [key(s.name), s.id]),
		);
		for (const name of preview.newSections) {
			const created = await insertSection(tx, tenant, {
				projectId: proj.id,
				kind,
				name,
			});
			sectionIds.set(key(name), created.id);
		}

		const typeIds = new Map(
			(
				await tx
					.select({ id: unitType.id, name: unitType.name })
					.from(unitType)
					.where(eq(unitType.projectId, proj.id))
			).map((t) => [key(t.name), t.id]),
		);
		for (const name of preview.newUnitTypes) {
			const [created] = await tx
				.insert(unitType)
				.values({
					organizationId: tenant.organizationId,
					projectId: proj.id,
					name,
				})
				.returning({ id: unitType.id });
			if (created) typeIds.set(key(name), created.id);
		}

		if (preview.newTags.length > 0) {
			await tx
				.update(project)
				.set({ unitTags: [...proj.unitTags, ...preview.newTags] })
				.where(eq(project.id, proj.id));
		}

		const values = rows.map((r) => {
			const sectionId = sectionIds.get(key(r.section));
			const unitTypeId = typeIds.get(key(r.unitType));
			if (!sectionId || !unitTypeId || r.listPriceSatang === null) {
				throw new Error(`Unresolved row ${r.line}`);
			}
			return {
				organizationId: tenant.organizationId,
				projectId: proj.id,
				sectionId,
				unitTypeId,
				floor: r.floor,
				unitNumber: r.unitNumber,
				landSizeSqwah: r.landSizeSqwah,
				usableAreaSqm: r.usableAreaSqm,
				facing: r.facing,
				tags: r.tags,
				listPriceSatang: r.listPriceSatang,
			};
		});
		for (let i = 0; i < values.length; i += 500) {
			await tx.insert(unit).values(values.slice(i, i + 500));
		}

		await writeAudit(tx, tenant, {
			action: "unit.import",
			entityType: "project",
			entityId: proj.id,
			after: {
				imported: values.length,
				skipped: preview.errorCount,
				sectionsCreated: preview.newSections.length,
				unitTypesCreated: preview.newUnitTypes.length,
			},
		});
		return {
			imported: values.length,
			skipped: preview.errorCount,
		};
	});
}

/** CSV template with the English headers and one example row. */
export function unitImportTemplate() {
	const header = [
		"section",
		"floor",
		"unit_number",
		"unit_type",
		"land_size_sqwah",
		"usable_area_sqm",
		"facing",
		"tags",
		"list_price",
	];
	const example = [
		"Building A",
		"8",
		"A-801",
		"1 Bedroom",
		"",
		"32.5",
		"NE",
		"corner, pool view",
		"3250000",
	];
	return `${header.join(",")}\r\n${example.map(csvCell).join(",")}\r\n`;
}
