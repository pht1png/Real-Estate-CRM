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
	appointmentCancelReasons,
	appointmentStatuses,
	buyerIntents,
	buyingTimelines,
	disqualifyReasons,
	fundingTypes,
	incomeRanges,
	leadStatuses,
	lostReasons,
	opportunityStatuses,
	type Rules,
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
		/** The contact meets us in person (walk-in, event): capture needs full details. */
		inPerson: boolean("in_person").notNull().default(false),
		/** Someone referred the contact: capture asks who (by phone). */
		referral: boolean("referral").notNull().default(false),
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

/**
 * Shared profile (brief §4). No national ID, ID card or income data (§10);
 * an income range lives on the lead, private to its owner.
 */
export const contact = pgTable(
	"contact",
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
		anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
		createdByUserId: text("created_by_user_id").references(() => user.id),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("contact_org_id_unique").on(table.organizationId, table.id),
		index("contact_org_name_idx").on(table.organizationId, table.name),
	],
);

export const contactPhone = pgTable(
	"contact_phone",
	{
		organizationId: text("organization_id").notNull(),
		contactId: uuid("contact_id").notNull(),
		/** E.164, e.g. +66812345678 (brief §3). */
		phoneE164: text("phone_e164").notNull(),
		isPrimary: boolean("is_primary").notNull().default(false),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.phoneE164] }),
		index("contact_phone_contact_idx").on(table.contactId),
		foreignKey({
			name: "contact_phone_contact_fkey",
			columns: [table.organizationId, table.contactId],
			foreignColumns: [contact.organizationId, contact.id],
		}).onDelete("cascade"),
		check(
			"contact_phone_e164_check",
			sql`${table.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`,
		),
	],
);

/**
 * Lead pipeline (the vetting queue, brief §2): a contact's enquiry about one
 * project. A confirmed showroom visit converts it into an opportunity.
 */
export const lead = pgTable(
	"lead",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		contactId: uuid("contact_id").notNull(),
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
		/** Household income per month, as a range only (brief §10). */
		incomeRange: text("income_range", { enum: incomeRanges }),
		/** Who referred the contact to this project (another contact). */
		referredByContactId: uuid("referred_by_contact_id"),
		nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		contactDeadlineAt: timestamp("contact_deadline_at", { withTimezone: true }),
		qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
		convertedAt: timestamp("converted_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("lead_contact_project_unique").on(table.contactId, table.projectId),
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
			name: "lead_contact_fkey",
			columns: [table.organizationId, table.contactId],
			foreignColumns: [contact.organizationId, contact.id],
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
			"lead_income_range_check",
			sql`${table.incomeRange} is null or ${table.incomeRange} in (${inList(incomeRanges)})`,
		),
		foreignKey({
			name: "lead_referred_by_fkey",
			columns: [table.organizationId, table.referredByContactId],
			foreignColumns: [contact.organizationId, contact.id],
		}),
		check(
			"lead_referrer_not_self_check",
			sql`${table.referredByContactId} is null or ${table.referredByContactId} <> ${table.contactId}`,
		),
		check(
			"lead_budget_check",
			sql`${table.budgetMinSatang} is null or ${table.budgetMaxSatang} is null or ${table.budgetMinSatang} <= ${table.budgetMaxSatang}`,
		),
	],
);

/**
 * Opportunity pipeline: created only by a confirmed showroom visit on a lead
 * (brief §2). Deposits (M6) attach here. Hot / warm is computed on read.
 */
export const opportunity = pgTable(
	"opportunity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		leadId: uuid("lead_id").notNull(),
		contactId: uuid("contact_id").notNull(),
		projectId: uuid("project_id").notNull(),
		ownerMemberId: text("owner_member_id").notNull(),
		status: text("status", { enum: opportunityStatuses })
			.notNull()
			.default("visited"),
		lostReason: text("lost_reason", { enum: lostReasons }),
		fundingType: text("funding_type", { enum: fundingTypes }),
		// Visit summary: written only by recordVisit (services/visits.ts).
		firstVisitAt: timestamp("first_visit_at", { withTimezone: true }).notNull(),
		lastVisitAt: timestamp("last_visit_at", { withTimezone: true }).notNull(),
		visitCount: integer("visit_count").notNull().default(1),
		nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
		lostAt: timestamp("lost_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("opportunity_org_id_unique").on(table.organizationId, table.id),
		// One live opportunity per lead; a lost one can be followed by a new visit.
		uniqueIndex("opportunity_one_live_per_lead_uidx")
			.on(table.leadId)
			.where(sql`${table.status} <> 'lost'`),
		index("opportunity_owner_status_idx").on(table.ownerMemberId, table.status),
		index("opportunity_project_status_idx").on(table.projectId, table.status),
		foreignKey({
			name: "opportunity_lead_fkey",
			columns: [table.organizationId, table.leadId],
			foreignColumns: [lead.organizationId, lead.id],
		}),
		foreignKey({
			name: "opportunity_contact_fkey",
			columns: [table.organizationId, table.contactId],
			foreignColumns: [contact.organizationId, contact.id],
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
			"opportunity_status_check",
			sql`${table.status} in (${inList(opportunityStatuses)})`,
		),
		check(
			"opportunity_lost_reason_check",
			sql`${table.lostReason} is null or ${table.lostReason} in (${inList(lostReasons)})`,
		),
		check(
			"opportunity_funding_type_check",
			sql`${table.fundingType} is null or ${table.fundingType} in (${inList(fundingTypes)})`,
		),
	],
);

/**
 * Showroom appointment (brief §6): current state only; every change is also
 * an activity. A first tour has no opportunity, a follow-up visit has the
 * lead's live one. A salesperson's scheduled appointments can't overlap (an
 * exclusion constraint added in the migration).
 */
export const appointment = pgTable(
	"appointment",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id").notNull(),
		leadId: uuid("lead_id").notNull(),
		opportunityId: uuid("opportunity_id"),
		/** The salesperson hosting. */
		memberId: text("member_id").notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
		status: text("status", { enum: appointmentStatuses })
			.notNull()
			.default("scheduled"),
		cancelReason: text("cancel_reason", { enum: appointmentCancelReasons }),
		createdByUserId: text("created_by_user_id").references(() => user.id),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		unique("appointment_org_id_unique").on(table.organizationId, table.id),
		index("appointment_lead_idx").on(table.leadId),
		index("appointment_scheduled_idx")
			.on(table.memberId, table.startsAt)
			.where(sql`${table.status} = 'scheduled'`),
		foreignKey({
			name: "appointment_lead_fkey",
			columns: [table.organizationId, table.leadId],
			foreignColumns: [lead.organizationId, lead.id],
		}),
		foreignKey({
			name: "appointment_opportunity_fkey",
			columns: [table.organizationId, table.opportunityId],
			foreignColumns: [opportunity.organizationId, opportunity.id],
		}),
		foreignKey({
			name: "appointment_member_fkey",
			columns: [table.organizationId, table.memberId],
			foreignColumns: [member.organizationId, member.id],
		}),
		check(
			"appointment_status_check",
			sql`${table.status} in (${inList(appointmentStatuses)})`,
		),
		check(
			"appointment_cancel_reason_check",
			sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null) and (${table.cancelReason} is null or ${table.cancelReason} in (${inList(appointmentCancelReasons)}))`,
		),
		check("appointment_time_check", sql`${table.startsAt} < ${table.endsAt}`),
	],
);

/**
 * Append-only timeline of a lead and its opportunities (a trigger rejects
 * UPDATE/DELETE). `opportunityId` is set for opportunity-phase entries.
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
		contact,
		contactPhone,
		lead,
		opportunity,
		appointment,
		activity,
		leadSource,
		leadChannel,
		campaign,
		project,
		unitType,
	},
	(r) => ({
		contact: {
			phones: r.many.contactPhone({
				from: r.contact.id,
				to: r.contactPhone.contactId,
			}),
			leads: r.many.lead({
				from: r.contact.id,
				to: r.lead.contactId,
			}),
			opportunities: r.many.opportunity({
				from: r.contact.id,
				to: r.opportunity.contactId,
			}),
		},
		lead: {
			contact: r.one.contact({
				from: r.lead.contactId,
				to: r.contact.id,
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
		appointment: {
			lead: r.one.lead({
				from: r.appointment.leadId,
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
