CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"time_period" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"content" text NOT NULL,
	"language" text NOT NULL,
	"translation" text NOT NULL,
	"script" text NOT NULL,
	"serifs_present" boolean NOT NULL,
	"stopmarks_present" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "object_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"hhw_identifier" text NOT NULL,
	"object_type_id" uuid,
	"museum_name" text NOT NULL,
	"museum_department" text,
	"museum_city" text NOT NULL,
	"museum_country" text NOT NULL,
	"museum_number" text NOT NULL,
	"museum_description" text,
	"date_culture_period" text NOT NULL,
	"dating_basis" text,
	"issuing_authority" text,
	"production_place" text,
	"findspot" text,
	"acquisition_date" text,
	"excavation_information" text,
	"materials" text NOT NULL,
	"technique" text,
	"dimensions" text NOT NULL,
	"thickness" text,
	"weight" text,
	"scientific_testing" text,
	"inscribed" boolean DEFAULT false NOT NULL,
	"imagery" boolean DEFAULT false NOT NULL,
	"imagery_description" text,
	"imagery_inscription_placement" text,
	"image_source_url" text,
	"image_type" text,
	"bibliography" text,
	"image_copyright_details" text,
	"collection_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
