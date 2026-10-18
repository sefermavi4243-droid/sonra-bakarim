CREATE TYPE "public"."category" AS ENUM('job', 'event', 'application', 'tool', 'read', 'task', 'other');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'telegram', 'webpush');--> statement-breakpoint
CREATE TYPE "public"."deadline_source" AS ENUM('explicit', 'inferred', 'default', 'user');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('open', 'snoozed', 'done', 'dropped', 'expired');--> statement-breakpoint
CREATE TYPE "public"."prep_kind" AS ENUM('cover_letter', 'checklist', 'summary', 'trial_plan');--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('plan', 'nudge', 'last_call', 'event_eve', 'event_soon', 'digest');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('link', 'image', 'audio', 'document', 'text', 'extension', 'email');--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"message_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_url" text,
	"raw_text" text,
	"media_path" text,
	"title" text NOT NULL,
	"category" "category" NOT NULL,
	"organization" text,
	"deadline_at" timestamp with time zone,
	"deadline_source" "deadline_source",
	"deadline_evidence" text,
	"event_at" timestamp with time zone,
	"location" text,
	"effort_minutes" integer,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_action" text,
	"status" "item_status" DEFAULT 'open' NOT NULL,
	"dedupe_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "preps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "prep_kind" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"message_id" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'Europe/Istanbul' NOT NULL,
	"quiet_start" text DEFAULT '22:00' NOT NULL,
	"quiet_end" text DEFAULT '08:00' NOT NULL,
	"preferred_hour" integer DEFAULT 20 NOT NULL,
	"digest_day" integer DEFAULT 0 NOT NULL,
	"cv_text" text,
	"pending_action" jsonb,
	"last_inbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preps" ADD CONSTRAINT "preps_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_message_id_key" ON "inbound_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "items_user_status_idx" ON "items" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "items_user_dedupe_idx" ON "items" USING btree ("user_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "reminders_item_idx" ON "reminders" USING btree ("item_id");