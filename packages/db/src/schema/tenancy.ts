import { defineRelationsPart, sql } from "drizzle-orm";
import {
	foreignKey,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { member, organization, user } from "./auth";

const createdAt = () =>
	timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
	timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull();

/** Minimal in M1 (scopes need it); M2 adds office hours, closed dates, commission, tags. */
export const project = pgTable(
	"project",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		name: text("name").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("project_organization_id_unique").on(table.organizationId, table.id),
		unique("project_organization_name_unique").on(
			table.organizationId,
			table.name,
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
