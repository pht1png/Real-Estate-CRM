import { defineRelationsPart, sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { member, organization, user } from "./auth";
import { createdAt, updatedAt } from "./columns";

export const projectTypes = ["condo", "low_rise", "mixed"] as const;
export type ProjectType = (typeof projectTypes)[number];

export const weekdays = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;
export type Weekday = (typeof weekdays)[number];

/** One open–close interval per weekday ("HH:MM", project time zone); null = closed. */
export type OfficeHours = Record<
	Weekday,
	{ open: string; close: string } | null
>;

export const defaultOfficeHours: OfficeHours = Object.fromEntries(
	weekdays.map((d) => [d, { open: "09:00", close: "18:00" }]),
) as OfficeHours;

export const project = pgTable(
	"project",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		name: text("name").notNull(),
		type: text("type", { enum: projectTypes }).notNull().default("condo"),
		/** IANA zone for office hours, closed dates and "working day". */
		timeZone: text("time_zone").notNull().default("Asia/Bangkok"),
		officeHours: jsonb("office_hours")
			.$type<OfficeHours>()
			.notNull()
			.default(defaultOfficeHours),
		/** Commission in basis points: 150 = 1.50 % of net price. */
		commissionBps: integer("commission_bps").notNull().default(0),
		/** Allowed tags for this project's units. */
		unitTags: text("unit_tags").array().notNull().default(sql`'{}'::text[]`),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("project_organization_id_unique").on(table.organizationId, table.id),
		unique("project_organization_name_unique").on(
			table.organizationId,
			table.name,
		),
		check(
			"project_type_check",
			sql`${table.type} in ('condo', 'low_rise', 'mixed')`,
		),
		check(
			"project_commission_bps_check",
			sql`${table.commissionBps} between 0 and 10000`,
		),
	],
);

/** A member's scope: the projects they cover (brief §4). */
export const projectMember = pgTable(
	"project_member",
	{
		organizationId: text("organization_id").notNull(),
		projectId: uuid("project_id").notNull(),
		memberId: text("member_id").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.projectId, table.memberId] }),
		index("project_member_member_idx").on(table.memberId),
		// Composite keys: the database rejects linking across organizations.
		foreignKey({
			name: "project_member_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "project_member_member_fkey",
			columns: [table.organizationId, table.memberId],
			foreignColumns: [member.organizationId, member.id],
		}).onDelete("cascade"),
	],
);

/** Per-organization display names for roles; defaults come from the i18n messages. */
export const roleLabel = pgTable(
	"role_label",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		role: text("role").notNull(),
		label: text("label").notNull(),
		updatedAt: updatedAt(),
	},
	(table) => [primaryKey({ columns: [table.organizationId, table.role] })],
);

/** Append-only (a trigger rejects UPDATE/DELETE). Payloads hold IDs, never personal data. */
export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		actorUserId: text("actor_user_id").references(() => user.id),
		action: text("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id").notNull(),
		before: jsonb("before").$type<Record<string, unknown>>(),
		after: jsonb("after").$type<Record<string, unknown>>(),
		createdAt: createdAt(),
	},
	(table) => [
		index("audit_log_organization_created_idx").on(
			table.organizationId,
			sql`${table.createdAt} desc`,
		),
	],
);

export const tenancyRelations = defineRelationsPart(
	{ project, projectMember, member },
	(r) => ({
		project: {
			members: r.many.projectMember({
				from: r.project.id,
				to: r.projectMember.projectId,
			}),
		},
		projectMember: {
			project: r.one.project({
				from: r.projectMember.projectId,
				to: r.project.id,
			}),
			member: r.one.member({
				from: r.projectMember.memberId,
				to: r.member.id,
			}),
		},
	}),
);
