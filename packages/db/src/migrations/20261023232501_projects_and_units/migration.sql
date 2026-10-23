CREATE TABLE "project_closed_date" (
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_closed_date_pkey" PRIMARY KEY("project_id","date")
);
--> statement-breakpoint
CREATE TABLE "section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_project_name_unique" UNIQUE("project_id","name"),
	CONSTRAINT "section_project_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "section_kind_check" CHECK ("kind" in ('phase', 'zone', 'building'))
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"floor" integer,
	"unit_number" text NOT NULL,
	"unit_type_id" uuid NOT NULL,
	"land_size_sqwah" numeric(10,2),
	"usable_area_sqm" numeric(10,2),
	"facing" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"list_price_satang" bigint NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_section_number_unique" UNIQUE("section_id","unit_number"),
	CONSTRAINT "unit_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "unit_status_check" CHECK ("status" in ('available', 'blocked', 'deposited', 'contracted', 'transferred')),
	CONSTRAINT "unit_facing_check" CHECK ("facing" is null or "facing" in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')),
	CONSTRAINT "unit_list_price_check" CHECK ("list_price_satang" > 0)
);
--> statement-breakpoint
CREATE TABLE "unit_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"old_price_satang" bigint NOT NULL,
	"new_price_satang" bigint NOT NULL,
	"changed_by_user_id" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bedrooms" smallint,
	"bathrooms" smallint,
	"usable_area_sqm" numeric(10,2),
	"floor_plan_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_type_project_name_unique" UNIQUE("project_id","name"),
	CONSTRAINT "unit_type_project_id_unique" UNIQUE("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "type" text DEFAULT 'condo' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "time_zone" text DEFAULT 'Asia/Bangkok' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "office_hours" jsonb DEFAULT '{"mon":{"open":"09:00","close":"18:00"},"tue":{"open":"09:00","close":"18:00"},"wed":{"open":"09:00","close":"18:00"},"thu":{"open":"09:00","close":"18:00"},"fri":{"open":"09:00","close":"18:00"},"sat":{"open":"09:00","close":"18:00"},"sun":{"open":"09:00","close":"18:00"}}' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "commission_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "unit_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "unit_project_status_idx" ON "unit" ("project_id","status");--> statement-breakpoint
CREATE INDEX "unit_price_history_unit_idx" ON "unit_price_history" ("unit_id","changed_at");--> statement-breakpoint
ALTER TABLE "project_closed_date" ADD CONSTRAINT "project_closed_date_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_section_fkey" FOREIGN KEY ("project_id","section_id") REFERENCES "section"("project_id","id");--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_unit_type_fkey" FOREIGN KEY ("project_id","unit_type_id") REFERENCES "unit_type"("project_id","id");--> statement-breakpoint
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_changed_by_user_id_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_unit_fkey" FOREIGN KEY ("organization_id","unit_id") REFERENCES "unit"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "unit_type" ADD CONSTRAINT "unit_type_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "project"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_type_check" CHECK ("type" in ('condo', 'low_rise', 'mixed'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_commission_bps_check" CHECK ("commission_bps" between 0 and 10000);