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
	buyerIntents,
	buyingTimelines,
	disqualifyReasons,
	leadStatuses,
	lostReasons,
	opportunityStages,
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
		/** The customer meets us in person (walk-in, event): capture needs full details. */
		inPerson: boolean("in_person").notNull().default(false),
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

/**
 * Lead pipeline (the vetting queue, brief §2): a customer's enquiry about one
 * project. A confirmed showroom visit converts it into an opportunity.
 */
export const lead = pgTable(
	"lead",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		customerId: uuid("customer_id").notNull(),
		projectId: uuid("project_id").notNull(),
		/** null = in the project's pool. */
		ownerMemberId: text("owner_member_id"),
		sourceId: uuid("source_id").notNull(),
		campaignId: uuid("campaign_id"),
		status: text("status", { enum: leadStatuses }).notNull().default("new"),
		disqualifyReason: text("disqualify_reason", { enum: disqualifyReasons }),
		priority: boolean("priority").notNull().default(false),
		/** Signals that made it priority, e.g. budget_in_range, timeline_soon. */
		prioritySignals: text("priority_signals")
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		scoringVersion: text("scoring_version"),
		scoredAt: timestamp("scored_at", { withTimezone: true }),
		// Qualification profile (brief §6 "Qualified").
		budgetMinSatang: satang("budget_min_satang"),
		budgetMaxSatang: satang("budget_max_satang"),
		buyingTimeline: text("buying_timeline", { enum: buyingTimelines }),
		unitTypeIds: uuid("unit_type_ids")
			.array()
			.notNull()
			.default(sql`'{}'::uuid[]`),
		buyerIntent: text("buyer_intent", { enum: buyerIntents }),
		paymentMethod: text("payment_method", { enum: paymentMethods }),
		loanPrechecked: boolean("loan_prechecked").notNull().default(false),
		nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		contactDeadlineAt: timestamp("contact_deadline_at", { withTimezone: true }),
		nurtureNextCheckAt: timestamp("nurture_next_check_at", {
			withTimezone: true,
		}),
		ignoredNurtureCount: integer("ignored_nurture_count").notNull().default(0),
		qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
		convertedAt: timestamp("converted_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("lead_customer_project_unique").on(
			table.customerId,
			table.projectId,
		),
		unique("lead_org_id_unique").on(table.organizationId, table.id),
		index("lead_project_owner_idx").on(
			table.projectId,
			table.ownerMemberId,
			table.status,
		),
		index("lead_owner_idx").on(table.ownerMemberId),
		// Expiry job: only leads still waiting for first contact have a deadline.
		index("lead_contact_deadline_idx")
			.on(table.contactDeadlineAt)
			.where(sql`${table.contactDeadlineAt} is not null`),
		foreignKey({
			name: "lead_customer_fkey",
			columns: [table.organizationId, table.customerId],
			foreignColumns: [customer.organizationId, customer.id],
		}),
		foreignKey({
			name: "lead_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}),
		foreignKey({
			name: "lead_owner_fkey",
			columns: [table.organizationId, table.ownerMemberId],
			foreignColumns: [member.organizationId, member.id],
		}),
		foreignKey({
			name: "lead_source_fkey",
			columns: [table.organizationId, table.sourceId],
			foreignColumns: [leadSource.organizationId, leadSource.id],
		}),
		// The campaign must belong to the lead's project.
		foreignKey({
			name: "lead_campaign_fkey",
			columns: [table.projectId, table.campaignId],
			foreignColumns: [campaign.projectId, campaign.id],
		}),
		check(
			"lead_status_check",
			sql`${table.status} in (${inList(leadStatuses)})`,
		),
		check(
			"lead_disqualify_reason_check",
			sql`${table.disqualifyReason} is null or ${table.disqualifyReason} in (${inList(disqualifyReasons)})`,
		),
		check(
			"lead_timeline_check",
			sql`${table.buyingTimeline} is null or ${table.buyingTimeline} in (${inList(buyingTimelines)})`,
		),
		check(
			"lead_intent_check",
			sql`${table.buyerIntent} is null or ${table.buyerIntent} in (${inList(buyerIntents)})`,
		),
		check(
			"lead_payment_check",
			sql`${table.paymentMethod} is null or ${table.paymentMethod} in (${inList(paymentMethods)})`,
		),
		check(
			"lead_budget_check",
			sql`${table.budgetMinSatang} is null or ${table.budgetMaxSatang} is null or ${table.budgetMinSatang} <= ${table.budgetMaxSatang}`,
		),
	],
);

/**
 * Opportunity (deal) pipeline: created only by a confirmed showroom visit on
 * a lead (brief §2). Deposits (M6) attach here.
 */
export const opportunity = pgTable(
	"opportunity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		leadId: uuid("lead_id").notNull(),
		customerId: uuid("customer_id").notNull(),
		projectId: uuid("project_id").notNull(),
		ownerMemberId: text("owner_member_id").notNull(),
		stage: text("stage", { enum: opportunityStages })
			.notNull()
			.default("visited"),
		lostReason: text("lost_reason", { enum: lostReasons }),
		firstVisitAt: timestamp("first_visit_at", { withTimezone: true }).notNull(),
		lastVisitAt: timestamp("last_visit_at", { withTimezone: true }).notNull(),
		visitCount: integer("visit_count").notNull().default(1),
		temperature: text("temperature", { enum: temperatures }),
		nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
		lostAt: timestamp("lost_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("opportunity_org_id_unique").on(table.organizationId, table.id),
		// One live deal per lead; a lost one can be followed by a new visit.
		uniqueIndex("opportunity_one_live_per_lead_uidx")
			.on(table.leadId)
			.where(sql`${table.stage} <> 'lost'`),
		index("opportunity_owner_stage_idx").on(table.ownerMemberId, table.stage),
		index("opportunity_project_stage_idx").on(table.projectId, table.stage),
		foreignKey({
			name: "opportunity_lead_fkey",
			columns: [table.organizationId, table.leadId],
			foreignColumns: [lead.organizationId, lead.id],
		}),
		foreignKey({
			name: "opportunity_customer_fkey",
			columns: [table.organizationId, table.customerId],
			foreignColumns: [customer.organizationId, customer.id],
		}),
		foreignKey({
			name: "opportunity_project_fkey",
			columns: [table.organizationId, table.projectId],
			foreignColumns: [project.organizationId, project.id],
		}),
		foreignKey({
			name: "opportunity_owner_fkey",
			columns: [table.organizationId, table.ownerMemberId],
			foreignColumns: [member.organizationId, member.id],
		}),
		check(
			"opportunity_stage_check",
			sql`${table.stage} in (${inList(opportunityStages)})`,
		),
		check(
			"opportunity_lost_reason_check",
			sql`${table.lostReason} is null or ${table.lostReason} in (${inList(lostReasons)})`,
		),
		check(
			"opportunity_temperature_check",
			sql`${table.temperature} is null or ${table.temperature} in (${inList(temperatures)})`,
		),
	],
);

/**
 * Append-only timeline of a lead and its deals (a trigger rejects
 * UPDATE/DELETE). `opportunityId` is set for deal-phase entries.
 */
export const activity = pgTable(
	"activity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		leadId: uuid("lead_id").notNull(),
		opportunityId: uuid("opportunity_id"),
		type: text("type", { enum: activityTypes }).notNull(),
		at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
		/** null = done by the system (e.g. a rule). */
		byUserId: text("by_user_id").references(() => user.id),
		note: text("note"),
		campaignId: uuid("campaign_id"),
		/** Type-specific details: status from/to, owner from/to, lead snapshot… */
		data: jsonb("data").$type<Record<string, unknown>>(),
	},
	(table) => [
		index("activity_lead_idx").on(table.leadId, table.at),
		index("activity_opportunity_idx").on(table.opportunityId),
		foreignKey({
			name: "activity_lead_fkey",
			columns: [table.organizationId, table.leadId],
			foreignColumns: [lead.organizationId, lead.id],
		}),
		foreignKey({
			name: "activity_opportunity_fkey",
			columns: [table.organizationId, table.opportunityId],
			foreignColumns: [opportunity.organizationId, opportunity.id],
		}),
		check(
			"activity_type_check",
			sql`${table.type} in (${inList(activityTypes)})`,
		),
	],
);

export const crmRelations = defineRelationsPart(
	{
		customer,
		customerPhone,
		lead,
		opportunity,
		activity,
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
			leads: r.many.lead({
				from: r.customer.id,
				to: r.lead.customerId,
			}),
			opportunities: r.many.opportunity({
				from: r.customer.id,
				to: r.opportunity.customerId,
			}),
		},
		lead: {
			customer: r.one.customer({
				from: r.lead.customerId,
				to: r.customer.id,
			}),
			activities: r.many.activity({
				from: r.lead.id,
				to: r.activity.leadId,
			}),
			opportunities: r.many.opportunity({
				from: r.lead.id,
				to: r.opportunity.leadId,
			}),
		},
		opportunity: {
			lead: r.one.lead({
				from: r.opportunity.leadId,
				to: r.lead.id,
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
