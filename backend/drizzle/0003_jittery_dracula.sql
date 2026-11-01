CREATE TYPE "public"."modification_change_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."modification_status" AS ENUM('PENDING', 'PARTIALLY_REVIEWED', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "modification_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"original_value" jsonb,
	"proposed_value" jsonb NOT NULL,
	"status" "modification_change_status" DEFAULT 'PENDING' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"modifier_id" text NOT NULL,
	"publisher_id" text NOT NULL,
	"status" "modification_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"href" text,
	"related_modification_request_id" uuid,
	"related_modification_change_id" uuid,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"contributor_id" text NOT NULL,
	"approved_by" text NOT NULL,
	"modification_change_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "object_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "modification_changes" ADD CONSTRAINT "modification_changes_request_id_modification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."modification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification_changes" ADD CONSTRAINT "modification_changes_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification_requests" ADD CONSTRAINT "modification_requests_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification_requests" ADD CONSTRAINT "modification_requests_modifier_id_users_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification_requests" ADD CONSTRAINT "modification_requests_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_modification_request_id_modification_requests_id_fk" FOREIGN KEY ("related_modification_request_id") REFERENCES "public"."modification_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_modification_change_id_modification_changes_id_fk" FOREIGN KEY ("related_modification_change_id") REFERENCES "public"."modification_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_contributor_id_users_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_modification_change_id_modification_changes_id_fk" FOREIGN KEY ("modification_change_id") REFERENCES "public"."modification_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "modification_changes_request_idx" ON "modification_changes" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "modification_changes_status_idx" ON "modification_changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "modification_requests_record_idx" ON "modification_requests" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "modification_requests_modifier_idx" ON "modification_requests" USING btree ("modifier_id");--> statement-breakpoint
CREATE INDEX "modification_requests_publisher_idx" ON "modification_requests" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "modification_requests_status_idx" ON "modification_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "record_versions_record_idx" ON "record_versions" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "record_versions_contributor_idx" ON "record_versions" USING btree ("contributor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_versions_change_unique" ON "record_versions" USING btree ("modification_change_id");