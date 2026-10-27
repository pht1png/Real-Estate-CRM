ALTER TABLE "customer" RENAME TO "contact";--> statement-breakpoint
ALTER TABLE "customer_phone" RENAME TO "contact_phone";--> statement-breakpoint
ALTER TABLE "contact" DROP CONSTRAINT "customer_referred_by_fkey";--> statement-breakpoint
ALTER TABLE "contact_phone" RENAME COLUMN "customer_id" TO "contact_id";--> statement-breakpoint
ALTER TABLE "lead" RENAME COLUMN "customer_id" TO "contact_id";--> statement-breakpoint
ALTER TABLE "opportunity" RENAME COLUMN "customer_id" TO "contact_id";--> statement-breakpoint
ALTER TABLE "contact_phone" RENAME CONSTRAINT "customer_phone_e164_check" TO "contact_phone_e164_check";--> statement-breakpoint
ALTER INDEX "customer_org_name_idx" RENAME TO "contact_org_name_idx";--> statement-breakpoint
ALTER INDEX "customer_phone_customer_idx" RENAME TO "contact_phone_contact_idx";--> statement-breakpoint
ALTER TABLE "contact_phone" RENAME CONSTRAINT "customer_phone_customer_fkey" TO "contact_phone_contact_fkey";--> statement-breakpoint
ALTER TABLE "lead" RENAME CONSTRAINT "lead_customer_fkey" TO "lead_contact_fkey";--> statement-breakpoint
ALTER TABLE "opportunity" RENAME CONSTRAINT "opportunity_customer_fkey" TO "opportunity_contact_fkey";--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "income_range" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "referred_by_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_channel" ADD COLUMN "referral" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The referrer moves from the contact to each of its leads.
UPDATE "lead" SET "referred_by_contact_id" = c."referred_by_customer_id"
	FROM "contact" c
	WHERE c."id" = "lead"."contact_id" AND c."referred_by_customer_id" IS NOT NULL
		AND c."referred_by_customer_id" <> "lead"."contact_id";--> statement-breakpoint
-- Existing companies: the default "Referral" channel asks who referred.
UPDATE "lead_channel" SET "referral" = true WHERE "name" = 'Referral';--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "referred_by_customer_id";--> statement-breakpoint
ALTER TABLE "contact" RENAME CONSTRAINT "customer_org_id_unique" TO "contact_org_id_unique";--> statement-breakpoint
ALTER TABLE "lead" RENAME CONSTRAINT "lead_customer_project_unique" TO "lead_contact_project_unique";--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_referred_by_fkey" FOREIGN KEY ("organization_id","referred_by_contact_id") REFERENCES "contact"("organization_id","id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_income_range_check" CHECK ("income_range" is null or "income_range" in ('under_30k', '30k_50k', '50k_100k', '100k_200k', 'over_200k'));--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_referrer_not_self_check" CHECK ("referred_by_contact_id" is null or "referred_by_contact_id" <> "contact_id");--> statement-breakpoint
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_cancel_reason_check";--> statement-breakpoint
UPDATE "appointment" SET "cancel_reason" = replace("cancel_reason", 'customer_', 'contact_') WHERE "cancel_reason" LIKE 'customer\_%';--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_cancel_reason_check" CHECK (("status" = 'cancelled') = ("cancel_reason" is not null) and ("cancel_reason" is null or "cancel_reason" in ('contact_cancelled', 'contact_unreachable', 'salesperson_unavailable', 'showroom_closed', 'other')));