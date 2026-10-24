import { defineRelationsPart, sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import {
	activityTypes,
	buyingTimelines,
	interestStages,
	paymentMethods,
	type Rules,
	temperatures,
} from "../constants";
import { member, organization, user } from "./auth";
import { createdAt, updatedAt } from "./columns";
import { unitType } from "./inventory";
import { project } from "./tenancy";

const inList = (values: readonly string[]) =>
	sql.raw(values.map((v) => `'${v}'`).join(", "));
const satang = (name: string) => bigint(name, { mode: "number" });

/** Per-company rule overrides; missing keys use `defaultRules`. */
export const organizationSettings = pgTable("organization_settings", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id),
	rules: jsonb("rules").$type<Partial<Rules>>().notNull().default({}),
	updatedAt: updatedAt(),
});

export const leadChannel = pgTable(
	"lead_channel",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		name: text("name").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: createdAt(),
	},
	(table) => [
		unique("lead_channel_org_name_unique").on(table.organizationId, table.name),
		unique("lead_channel_org_id_unique").on(table.organizationId, table.id),
	],
);

/** Two-level list (brief §5): channel → source; exactly one "Don't know" per company. */
export const leadSource = pgTable(
	"lead_source",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		channelId: uuid("channel_id"),
		name: text("name").notNull(),
		isUnknown: boolean("is_unknown").notNull().default(false),
		sortOrder: integer("sort_order").notNull().default(0),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(table) => [
		unique("lead_source_org_id_unique").on(table.organizationId, table.id),
		uniqueIndex("lead_source_one_unknown_uidx")
			.on(table.organizationId)
			.where(sql`${table.isUnknown}`),
		foreignKey({
			name: "lead_source_channel_fkey",
			columns: [table.organizationId, table.channelId],
			foreignColumns: [leadChannel.organizationId, leadChannel.id],
		}),
		// Real sources belong to a channel; only "Don't know" stands alone.
		check(
			"lead_source_channel_check",
			sql`${table.isUnknown} or ${table.channelId} is not null`,
		),
	],
);

export const campaign = pgTable(
	"campaign",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		projectId: uuid("project_id").notNull(),
		channelId: uuid("channel_id").notNull(),
		name: text("name").notNull(),
		/** e.g. BSN-FB-LEADFORM-2026-11; matched by the intake webhook (M9). */
		code: text("code").notNull(),
		startsOn: text("starts_on").notNull(),
		endsOn: text("ends_on"),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("campaign_org_code_uidx").on(
			table.organizationId,
			sql`lower(${table.code})`,
		),
		unique("campaign_project_id_unique").on(table.projectId, table.id),
		foreignKey({
			name: "campaign_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}),
		foreignKey({
			name: "campaign_channel_fkey",
			columns: [table.organizationId, table.channelId],
			foreignColumns: [leadChannel.organizationId, leadChannel.id],
		}),
	],
);

/** Shared profile (brief §4). No national ID, ID card or income data (§10). */
export const customer = pgTable(
	"customer",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		name: text("name").notNull(),
		lineId: text("line_id"),
		email: text("email"),
		marketingConsent: boolean("marketing_consent").notNull(),
		consentRecordedByUserId: text("consent_recorded_by_user_id").references(
			() => user.id,
		),
		consentRecordedAt: timestamp("consent_recorded_at", {
			withTimezone: true,
		}).notNull(),
		referredByCustomerId: uuid("referred_by_customer_id"),
		anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
		createdByUserId: text("created_by_user_id").references(() => user.id),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("customer_org_id_unique").on(table.organizationId, table.id),
		index("customer_org_name_idx").on(table.organizationId, table.name),
		foreignKey({
			name: "customer_referred_by_fkey",
			columns: [table.organizationId, table.referredByCustomerId],
			foreignColumns: [table.organizationId, table.id],
		}),
	],
);

export const customerPhone = pgTable(
	"customer_phone",
	{
		organizationId: text("organization_id").notNull(),
		customerId: uuid("customer_id").notNull(),
		/** E.164, e.g. +66812345678 (brief §3). */
		phoneE164: text("phone_e164").notNull(),
		isPrimary: boolean("is_primary").notNull().default(false),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.phoneE164] }),
		index("customer_phone_customer_idx").on(table.customerId),
		foreignKey({
			name: "customer_phone_customer_fkey",
			columns: [table.organizationId, table.customerId],
			foreignColumns: [customer.organizationId, customer.id],
		}).onDelete("cascade"),
		check(
			"customer_phone_e164_check",
			sql`${table.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`,
		),
	],
);

/** A customer's interest in one project (never in a unit; brief §1). */
export const interest = pgTable(
	"interest",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		customerId: uuid("customer_id").notNull(),
		projectId: uuid("project_id").notNull(),
		/** null = in the project's pool. */
		ownerMemberId: text("owner_member_id"),
		sourceId: uuid("source_id").notNull(),
		campaignId: uuid("campaign_id"),
		stage: text("stage", { enum: interestStages }).notNull().default("new"),
		priority: boolean("priority").notNull().default(false),
		/** Signals that made it priority, e.g. budget_in_range, timeline_soon. */
		prioritySignals: text("priority_signals")
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		scoringVersion: text("scoring_version"),
		scoredAt: timestamp("scored_at", { withTimezone: true }),
		budgetMinSatang: satang("budget_min_satang"),
		budgetMaxSatang: satang("budget_max_satang"),
		buyingTimeline: text("buying_timeline", { enum: buyingTimelines }),
		unitTypeIds: uuid("unit_type_ids")
			.array()
			.notNull()
			.default(sql`'{}'::uuid[]`),
		paymentMethod: text("payment_method", { enum: paymentMethods }),
		loanPrechecked: boolean("loan_prechecked").notNull().default(false),
		visitCount: integer("visit_count").notNull().default(0),
		temperature: text("temperature", { enum: temperatures }),
		nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		contactDeadlineAt: timestamp("contact_deadline_at", { withTimezone: true }),
		lostReason: text("lost_reason"),
		invalidReason: text("invalid_reason"),
		nurtureNextCheckAt: timestamp("nurture_next_check_at", {
			withTimezone: true,
		}),
		ignoredNurtureCount: integer("ignored_nurture_count").notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("interest_customer_project_unique").on(
			table.customerId,
			table.projectId,
		),
		unique("interest_org_id_unique").on(table.organizationId, table.id),
		index("interest_project_owner_idx").on(
			table.projectId,
			table.ownerMemberId,
			table.stage,
		),
		index("interest_owner_idx").on(table.ownerMemberId),
		// Expiry job: only leads still waiting for first contact have a deadline.
		index("interest_contact_deadline_idx")
			.on(table.contactDeadlineAt)
			.where(sql`${table.contactDeadlineAt} is not null`),
		foreignKey({
			name: "interest_customer_fkey",
			columns: [table.organizationId, table.customerId],
			foreignColumns: [customer.organizationId, customer.id],
		}),
		foreignKey({
			name: "interest_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}),
		foreignKey({
			name: "interest_owner_fkey",
			columns: [table.organizationId, table.ownerMemberId],
			foreignColumns: [member.organizationId, member.id],
		}),
		foreignKey({
			name: "interest_source_fkey",
			columns: [table.organizationId, table.sourceId],
			foreignColumns: [leadSource.organizationId, leadSource.id],
		}),
		// The campaign must belong to the interest's project.
		foreignKey({
			name: "interest_campaign_fkey",
			columns: [table.projectId, table.campaignId],
			foreignColumns: [campaign.projectId, campaign.id],
		}),
		check(
			"interest_stage_check",
			sql`${table.stage} in (${inList(interestStages)})`,
		),
		check(
			"interest_timeline_check",
			sql`${table.buyingTimeline} is null or ${table.buyingTimeline} in (${inList(buyingTimelines)})`,
		),
		check(
			"interest_payment_check",
			sql`${table.paymentMethod} is null or ${table.paymentMethod} in (${inList(paymentMethods)})`,
		),
		check(
			"interest_temperature_check",
			sql`${table.temperature} is null or ${table.temperature} in (${inList(temperatures)})`,
		),
		check(
			"interest_budget_check",
			sql`${table.budgetMinSatang} is null or ${table.budgetMaxSatang} is null or ${table.budgetMinSatang} <= ${table.budgetMaxSatang}`,
		),
	],
);

/** Append-only history of an interest (a trigger rejects UPDATE/DELETE). */
export const interestActivity = pgTable(
	"interest_activity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		interestId: uuid("interest_id").notNull(),
		type: text("type", { enum: activityTypes }).notNull(),
		at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
		/** null = done by the system (e.g. a rule). */
		byUserId: text("by_user_id").references(() => user.id),
		note: text("note"),
		campaignId: uuid("campaign_id"),
		/** Type-specific details: stage from/to, owner from/to, lead snapshot… */
		data: jsonb("data").$type<Record<string, unknown>>(),
	},
	(table) => [
		index("interest_activity_interest_idx").on(table.interestId, table.at),
		foreignKey({
			name: "interest_activity_interest_fkey",
			columns: [table.organizationId, table.interestId],
			foreignColumns: [interest.organizationId, interest.id],
		}),
		check(
			"interest_activity_type_check",
			sql`${table.type} in (${inList(activityTypes)})`,
		),
	],
);

export const crmRelations = defineRelationsPart(
	{
		customer,
		customerPhone,
		interest,
		interestActivity,
		leadSource,
		leadChannel,
		campaign,
		project,
		unitType,
	},
	(r) => ({
		customer: {
			phones: r.many.customerPhone({
				from: r.customer.id,
				to: r.customerPhone.customerId,
			}),
			interests: r.many.interest({
				from: r.customer.id,
				to: r.interest.customerId,
			}),
		},
		interest: {
			customer: r.one.customer({
				from: r.interest.customerId,
				to: r.customer.id,
			}),
			activities: r.many.interestActivity({
				from: r.interest.id,
				to: r.interestActivity.interestId,
			}),
		},
		leadSource: {
			channel: r.one.leadChannel({
				from: r.leadSource.channelId,
				to: r.leadChannel.id,
			}),
		},
	}),
);
