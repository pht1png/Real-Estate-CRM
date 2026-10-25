CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"type" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" text,
	"note" text,
	"campaign_id" uuid,
	"data" jsonb,
	CONSTRAINT "activity_type_check" CHECK ("type" in ('enquiry', 'call', 'no_answer', 'line', 'meeting', 'visit', 'note', 'stage_change', 're_engagement', 'assignment', 'qualified', 'conversion'))
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_member_id" text,
	"source_id" uuid NOT NULL,
	"campaign_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"disqualify_reason" text,
	"priority" boolean DEFAULT false NOT NULL,
	"priority_signals" text[] DEFAULT '{}'::text[] NOT NULL,
	"scoring_version" text,
	"scored_at" timestamp with time zone,
	"budget_min_satang" bigint,
	"budget_max_satang" bigint,
	"buying_timeline" text,
	"unit_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"buyer_intent" text,
	"payment_method" text,
	"loan_prechecked" boolean DEFAULT false NOT NULL,
	"next_follow_up_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"contact_deadline_at" timestamp with time zone,
	"nurture_next_check_at" timestamp with time zone,
	"ignored_nurture_count" integer DEFAULT 0 NOT NULL,
	"qualified_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_customer_project_unique" UNIQUE("customer_id","project_id"),
	CONSTRAINT "lead_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lead_status_check" CHECK ("status" in ('new', 'attempting', 'connected', 'qualified', 'nurturing', 'converted', 'disqualified')),
	CONSTRAINT "lead_disqualify_reason_check" CHECK ("disqualify_reason" is null or "disqualify_reason" in ('invalid_data', 'spam', 'duplicate', 'agent_competitor', 'job_seeker', 'bad_budget_fit', 'bad_location_fit', 'unreachable', 'other')),
	CONSTRAINT "lead_timeline_check" CHECK ("buying_timeline" is null or "buying_timeline" in ('under_1_month', '1_3_months', '3_6_months', '6_12_months', 'over_12_months', 'unknown')),
	CONSTRAINT "lead_intent_check" CHECK ("buyer_intent" is null or "buyer_intent" in ('own_stay', 'investment')),
	CONSTRAINT "lead_payment_check" CHECK ("payment_method" is null or "payment_method" in ('cash', 'mortgage')),
	CONSTRAINT "lead_budget_check" CHECK ("budget_min_satang" is null or "budget_max_satang" is null or "budget_min_satang" <= "budget_max_satang")
);
--> statement-breakpoint
CREATE TABLE "opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_member_id" text NOT NULL,
	"stage" text DEFAULT 'visited' NOT NULL,
	"lost_reason" text,
	"first_visit_at" timestamp with time zone NOT NULL,
	"last_visit_at" timestamp with time zone NOT NULL,
	"visit_count" integer DEFAULT 1 NOT NULL,
	"temperature" text,
	"next_follow_up_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "opportunity_stage_check" CHECK ("stage" in ('visited', 'negotiating', 'deposited', 'contracted', 'transferred', 'lost')),
	CONSTRAINT "opportunity_lost_reason_check" CHECK ("lost_reason" is null or "lost_reason" in ('bought_competitor', 'loan_rejected', 'cold_feet', 'product_mismatch', 'timing_postponed', 'other')),
	CONSTRAINT "opportunity_temperature_check" CHECK ("temperature" is null or "temperature" in ('warm', 'hot'))
);
--> statement-breakpoint
CREATE INDEX "activity_lead_idx" ON "activity" ("lead_id","at");--> statement-breakpoint
CREATE INDEX "activity_opportunity_idx" ON "activity" ("opportunity_id");--> statement-breakpoint
CREATE INDEX "lead_project_owner_idx" ON "lead" ("project_id","owner_member_id","status");--> statement-breakpoint
CREATE INDEX "lead_owner_idx" ON "lead" ("owner_member_id");--> statement-breakpoint
CREATE INDEX "lead_contact_deadline_idx" ON "lead" ("contact_deadline_at") WHERE "contact_deadline_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_one_live_per_lead_uidx" ON "opportunity" ("lead_id") WHERE "stage" <> 'lost';--> statement-breakpoint
CREATE INDEX "opportunity_owner_stage_idx" ON "opportunity" ("owner_member_id","stage");--> statement-breakpoint
CREATE INDEX "opportunity_project_stage_idx" ON "opportunity" ("project_id","stage");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_by_user_id_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_lead_fkey" FOREIGN KEY ("organization_id","lead_id") REFERENCES "lead"("organization_id","id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_opportunity_fkey" FOREIGN KEY ("organization_id","opportunity_id") REFERENCES "opportunity"("organization_id","id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_customer_fkey" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customer"("organization_id","id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_owner_fkey" FOREIGN KEY ("organization_id","owner_member_id") REFERENCES "member"("organization_id","id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_source_fkey" FOREIGN KEY ("organization_id","source_id") REFERENCES "lead_source"("organization_id","id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_campaign_fkey" FOREIGN KEY ("project_id","campaign_id") REFERENCES "campaign"("project_id","id");--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_lead_fkey" FOREIGN KEY ("organization_id","lead_id") REFERENCES "lead"("organization_id","id");--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_customer_fkey" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customer"("organization_id","id");--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id");--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_owner_fkey" FOREIGN KEY ("organization_id","owner_member_id") REFERENCES "member"("organization_id","id");