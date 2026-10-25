ALTER TABLE "lead_channel" ADD COLUMN "in_person" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "qualification_rules" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Existing companies: the default "Offline" channel is where customers meet us in person.
UPDATE "lead_channel" SET "in_person" = true WHERE "name" = 'Offline';
