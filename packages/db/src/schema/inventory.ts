import { defineRelationsPart, sql } from "drizzle-orm";
import {
	bigint,
	check,
	date,
	foreignKey,
	index,
	integer,
	numeric,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { facings, sectionKinds, unitStatuses } from "../constants";
import { user } from "./auth";
import { createdAt, updatedAt } from "./columns";
import { project } from "./tenancy";

const inList = (values: readonly string[]) =>
	sql.raw(values.map((v) => `'${v}'`).join(", "));

/** Area in m² or square wah, two decimals; read as a JS number. */
const area = (name: string) =>
	numeric(name, { precision: 10, scale: 2, mode: "number" });

/** Days the project's sales office is closed (holidays); per project, some stay open. */
export const projectClosedDate = pgTable(
	"project_closed_date",
	{
		organizationId: text("organization_id").notNull(),
		projectId: uuid("project_id").notNull(),
		date: date("date", { mode: "string" }).notNull(),
		note: text("note"),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.projectId, table.date] }),
		foreignKey({
			name: "project_closed_date_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}).onDelete("cascade"),
	],
);

export const section = pgTable(
	"section",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		projectId: uuid("project_id").notNull(),
		kind: text("kind", { enum: sectionKinds }).notNull(),
		name: text("name").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("section_project_name_unique").on(table.projectId, table.name),
		unique("section_project_id_unique").on(table.projectId, table.id),
		foreignKey({
			name: "section_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}).onDelete("cascade"),
		check(
			"section_kind_check",
			sql`${table.kind} in (${inList(sectionKinds)})`,
		),
	],
);

export const unitType = pgTable(
	"unit_type",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		projectId: uuid("project_id").notNull(),
		name: text("name").notNull(),
		bedrooms: smallint("bedrooms"),
		bathrooms: smallint("bathrooms"),
		usableAreaSqm: area("usable_area_sqm"),
		/** Storage key of the floor plan image; served via signed URLs only. */
		floorPlanKey: text("floor_plan_key"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("unit_type_project_name_unique").on(table.projectId, table.name),
		unique("unit_type_project_id_unique").on(table.projectId, table.id),
		foreignKey({
			name: "unit_type_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}).onDelete("cascade"),
	],
);

export const unit = pgTable(
	"unit",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		projectId: uuid("project_id").notNull(),
		sectionId: uuid("section_id").notNull(),
		/** Condo floor (ground = 1); null for low-rise. */
		floor: integer("floor"),
		/** House, plot or room number. */
		unitNumber: text("unit_number").notNull(),
		unitTypeId: uuid("unit_type_id").notNull(),
		landSizeSqwah: area("land_size_sqwah"),
		/** Overrides the unit type's area when set. */
		usableAreaSqm: area("usable_area_sqm"),
		facing: text("facing", { enum: facings }),
		tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
		/** Integer satang (brief: money as bigint). */
		listPriceSatang: bigint("list_price_satang", { mode: "number" }).notNull(),
		status: text("status", { enum: unitStatuses })
			.notNull()
			.default("available"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("unit_section_number_unique").on(table.sectionId, table.unitNumber),
		unique("unit_organization_id_unique").on(table.organizationId, table.id),
		index("unit_project_status_idx").on(table.projectId, table.status),
		foreignKey({
			name: "unit_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}).onDelete("cascade"),
		// Section and type must belong to the same project as the unit.
		foreignKey({
			name: "unit_section_fkey",
			columns: [table.projectId, table.sectionId],
			foreignColumns: [section.projectId, section.id],
		}),
		foreignKey({
			name: "unit_unit_type_fkey",
			columns: [table.projectId, table.unitTypeId],
			foreignColumns: [unitType.projectId, unitType.id],
		}),
		check(
			"unit_status_check",
			sql`${table.status} in (${inList(unitStatuses)})`,
		),
		check(
			"unit_facing_check",
			sql`${table.facing} is null or ${table.facing} in (${inList(facings)})`,
		),
		check("unit_list_price_check", sql`${table.listPriceSatang} > 0`),
	],
);

/** Every list-price change, append-only (a trigger rejects UPDATE/DELETE). */
export const unitPriceHistory = pgTable(
	"unit_price_history",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		unitId: uuid("unit_id").notNull(),
		oldPriceSatang: bigint("old_price_satang", { mode: "number" }).notNull(),
		newPriceSatang: bigint("new_price_satang", { mode: "number" }).notNull(),
		changedByUserId: text("changed_by_user_id").references(() => user.id),
		changedAt: timestamp("changed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		reason: text("reason").notNull(),
	},
	(table) => [
		index("unit_price_history_unit_idx").on(table.unitId, table.changedAt),
		foreignKey({
			name: "unit_price_history_unit_fkey",
			columns: [table.organizationId, table.unitId],
			foreignColumns: [unit.organizationId, unit.id],
		}).onDelete("cascade"),
	],
);

export const inventoryRelations = defineRelationsPart(
	{ project, section, unitType, unit, unitPriceHistory },
	(r) => ({
		section: {
			project: r.one.project({ from: r.section.projectId, to: r.project.id }),
			units: r.many.unit({ from: r.section.id, to: r.unit.sectionId }),
		},
		unitType: {
			units: r.many.unit({ from: r.unitType.id, to: r.unit.unitTypeId }),
		},
		unit: {
			section: r.one.section({ from: r.unit.sectionId, to: r.section.id }),
			unitType: r.one.unitType({ from: r.unit.unitTypeId, to: r.unitType.id }),
			priceHistory: r.many.unitPriceHistory({
				from: r.unit.id,
				to: r.unitPriceHistory.unitId,
			}),
		},
	}),
);
