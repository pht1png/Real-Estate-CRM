CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"starts_on" text NOT NULL,
	"ends_on" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_project_id_unique" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"line_id" text,
	"email" text,
	"marketing_consent" boolean NOT NULL,
	"consent_recorded_by_user_id" text,
	"consent_recorded_at" timestamp with time zone NOT NULL,
	"referred_by_customer_id" uuid,
	"anonymised_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer_phone" (
	"organization_id" text,
	"customer_id" uuid NOT NULL,
	"phone_e164" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_phone_pkey" PRIMARY KEY("organization_id","phone_e164"),
	CONSTRAINT "customer_phone_e164_check" CHECK ("phone_e164" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_member_id" text,
	"source_id" uuid NOT NULL,
	"campaign_id" uuid,
	"stage" text DEFAULT 'new' NOT NULL,
	"priority" boolean DEFAULT false NOT NULL,
	"priority_signals" text[] DEFAULT '{}'::text[] NOT NULL,
	"scoring_version" text,
	"scored_at" timestamp with time zone,
	"budget_min_satang" bigint,
	"budget_max_satang" bigint,
	"buying_timeline" text,
	"unit_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"payment_method" text,
	"loan_prechecked" boolean DEFAULT false NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"temperature" text,
	"next_follow_up_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"contact_deadline_at" timestamp with time zone,
	"lost_reason" text,
	"invalid_reason" text,
	"nurture_next_check_at" timestamp with time zone,
	"ignored_nurture_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_customer_project_unique" UNIQUE("customer_id","project_id"),
	CONSTRAINT "interest_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "interest_stage_check" CHECK ("stage" in ('new', 'contacted', 'visited', 'deposited', 'contracted', 'transferred', 'lost', 'nurture', 'invalid')),
	CONSTRAINT "interest_timeline_check" CHECK ("buying_timeline" is null or "buying_timeline" in ('under_1_month', '1_3_months', '3_6_months', '6_12_months', 'over_12_months', 'unknown')),
	CONSTRAINT "interest_payment_check" CHECK ("payment_method" is null or "payment_method" in ('cash', 'mortgage')),
	CONSTRAINT "interest_temperature_check" CHECK ("temperature" is null or "temperature" in ('warm', 'hot')),
	CONSTRAINT "interest_budget_check" CHECK ("budget_min_satang" is null or "budget_max_satang" is null or "budget_min_satang" <= "budget_max_satang")
);
--> statement-breakpoint
CREATE TABLE "interest_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"interest_id" uuid NOT NULL,
	"type" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" text,
	"note" text,
	"campaign_id" uuid,
	"data" jsonb,
	CONSTRAINT "interest_activity_type_check" CHECK ("type" in ('enquiry', 'call', 'no_answer', 'line', 'meeting', 'visit', 'note', 'stage_change', 're_engagement', 'assignment'))
);
--> statement-breakpoint
CREATE TABLE "lead_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_channel_org_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "lead_channel_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"channel_id" uuid,
	"name" text NOT NULL,
	"is_unknown" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_source_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lead_source_channel_check" CHECK ("is_unknown" or "channel_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" text PRIMARY KEY,
	"rules" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_org_code_uidx" ON "campaign" ("organization_id",lower("code"));--> statement-breakpoint
CREATE INDEX "customer_org_name_idx" ON "customer" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "customer_phone_customer_idx" ON "customer_phone" ("customer_id");--> statement-breakpoint
CREATE INDEX "interest_project_owner_idx" ON "interest" ("project_id","owner_member_id","stage");--> statement-breakpoint
CREATE INDEX "interest_owner_idx" ON "interest" ("owner_member_id");--> statement-breakpoint
CREATE INDEX "interest_activity_interest_idx" ON "interest_activity" ("interest_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_source_one_unknown_uidx" ON "lead_source" ("organization_id") WHERE "is_unknown";--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id");--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_channel_fkey" FOREIGN KEY ("organization_id","channel_id") REFERENCES "lead_channel"("organization_id","id");--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_consent_recorded_by_user_id_user_id_fkey" FOREIGN KEY ("consent_recorded_by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_referred_by_fkey" FOREIGN KEY ("organization_id","referred_by_customer_id") REFERENCES "customer"("organization_id","id");--> statement-breakpoint
ALTER TABLE "customer_phone" ADD CONSTRAINT "customer_phone_customer_fkey" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customer"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_customer_fkey" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customer"("organization_id","id");--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id");--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_owner_fkey" FOREIGN KEY ("organization_id","owner_member_id") REFERENCES "member"("organization_id","id");--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_source_fkey" FOREIGN KEY ("organization_id","source_id") REFERENCES "lead_source"("organization_id","id");--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_campaign_fkey" FOREIGN KEY ("project_id","campaign_id") REFERENCES "campaign"("project_id","id");--> statement-breakpoint
ALTER TABLE "interest_activity" ADD CONSTRAINT "interest_activity_by_user_id_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "interest_activity" ADD CONSTRAINT "interest_activity_interest_fkey" FOREIGN KEY ("organization_id","interest_id") REFERENCES "interest"("organization_id","id");--> statement-breakpoint
ALTER TABLE "lead_channel" ADD CONSTRAINT "lead_channel_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "lead_source" ADD CONSTRAINT "lead_source_channel_fkey" FOREIGN KEY ("organization_id","channel_id") REFERENCES "lead_channel"("organization_id","id");--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id");