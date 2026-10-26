CREATE TABLE "appointment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"member_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancel_reason" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_status_check" CHECK ("status" in ('scheduled', 'arrived', 'no_show', 'cancelled')),
	CONSTRAINT "appointment_cancel_reason_check" CHECK (("status" = 'cancelled') = ("cancel_reason" is not null) and ("cancel_reason" is null or "cancel_reason" in ('customer_cancelled', 'customer_unreachable', 'salesperson_unavailable', 'showroom_closed', 'other'))),
	CONSTRAINT "appointment_time_check" CHECK ("starts_at" < "ends_at")
);
--> statement-breakpoint
ALTER TABLE "opportunity" RENAME COLUMN "stage" TO "status";--> statement-breakpoint
ALTER TABLE "opportunity" DROP CONSTRAINT "opportunity_stage_check";--> statement-breakpoint
ALTER TABLE "opportunity" DROP CONSTRAINT "opportunity_temperature_check";--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT "lead_payment_check";--> statement-breakpoint
ALTER INDEX "opportunity_owner_stage_idx" RENAME TO "opportunity_owner_status_idx";--> statement-breakpoint
ALTER INDEX "opportunity_project_stage_idx" RENAME TO "opportunity_project_status_idx";--> statement-breakpoint
ALTER TABLE "opportunity" ADD COLUMN "funding_type" text;--> statement-breakpoint
ALTER TABLE "opportunity" DROP COLUMN "temperature";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "payment_method";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "loan_prechecked";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "nurture_next_check_at";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "ignored_nurture_count";--> statement-breakpoint
DROP INDEX "opportunity_one_live_per_lead_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_one_live_per_lead_uidx" ON "opportunity" ("lead_id") WHERE "status" <> 'lost';--> statement-breakpoint
CREATE INDEX "appointment_lead_idx" ON "appointment" ("lead_id");--> statement-breakpoint
CREATE INDEX "appointment_scheduled_idx" ON "appointment" ("member_id","starts_at") WHERE "status" = 'scheduled';--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_lead_fkey" FOREIGN KEY ("organization_id","lead_id") REFERENCES "lead"("organization_id","id");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_opportunity_fkey" FOREIGN KEY ("organization_id","opportunity_id") REFERENCES "opportunity"("organization_id","id");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_member_fkey" FOREIGN KEY ("organization_id","member_id") REFERENCES "member"("organization_id","id");--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_status_check" CHECK ("status" in ('visited', 'negotiating', 'deposited', 'contracted', 'waiting_mortgage_result', 'transferred', 'lost'));--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_funding_type_check" CHECK ("funding_type" is null or "funding_type" in ('cash', 'mortgage', 'cash_mortgage'));--> statement-breakpoint
ALTER TABLE "activity" DROP CONSTRAINT "activity_type_check";--> statement-breakpoint
-- Leads and opportunities both have a status now: rename the history type.
-- The append-only trigger is lifted for this one rewrite only.
ALTER TABLE "activity" DISABLE TRIGGER "activity_append_only";--> statement-breakpoint
UPDATE "activity" SET "type" = 'status_change' WHERE "type" = 'stage_change';--> statement-breakpoint
ALTER TABLE "activity" ENABLE TRIGGER "activity_append_only";--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_type_check" CHECK ("type" in ('enquiry', 'call', 'no_answer', 'line', 'meeting', 'visit', 'note', 'status_change', 're_engagement', 'assignment', 'qualified', 'conversion', 'appointment_booked', 'appointment_rescheduled', 'appointment_cancelled', 'appointment_no_show'));--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT "lead_disqualify_reason_check", ADD CONSTRAINT "lead_disqualify_reason_check" CHECK ("disqualify_reason" is null or "disqualify_reason" in ('invalid_data', 'spam', 'duplicate', 'agent_competitor', 'job_seeker', 'bad_budget_fit', 'bad_location_fit', 'unreachable', 'not_interested', 'bought_elsewhere', 'unresponsive', 'other'));--> statement-breakpoint
-- Nurture now releases the lead into the nurturing pool (brief §6).
UPDATE "lead" SET "owner_member_id" = NULL, "claimed_at" = NULL, "contact_deadline_at" = NULL, "next_follow_up_at" = NULL WHERE "status" = 'nurturing';--> statement-breakpoint
-- No double-booking (brief §6): a salesperson's scheduled appointments never overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_no_overlap" EXCLUDE USING gist ("member_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'scheduled');
