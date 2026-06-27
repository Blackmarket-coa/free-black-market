import { Migration } from "@mikro-orm/migrations"

/**
 * Wellness module schema. All enum-like columns are TEXT (app-level unions) to
 * keep the migration idempotent and simple — matching the `booking` /
 * `embed_event` convention. Tables are prefixed `wellness_` (the platform
 * already owns a `member` table). All indexes are partial on deleted_at.
 */
export class Migration20260627CreateWellness extends Migration {
  async up(): Promise<void> {
    // ---- wellness_session_type -------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_session_type" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "product_id" TEXT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NULL,
        "duration_minutes" INTEGER NOT NULL DEFAULT 60,
        "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
        "price_amount" INTEGER NULL,
        "currency_code" TEXT NULL,
        "color" TEXT NULL,
        "location_type" TEXT NOT NULL DEFAULT 'video',
        "intake_form_id" TEXT NULL,
        "prep_instructions" TEXT NULL,
        "max_per_week" INTEGER NULL,
        "is_embeddable" BOOLEAN NOT NULL DEFAULT true,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_session_type_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_session_type_seller_id" ON "wellness_session_type" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_session_type_product_id" ON "wellness_session_type" ("product_id") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_class_event --------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_class_event" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "product_id" TEXT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "starts_at" TIMESTAMPTZ NOT NULL,
        "ends_at" TIMESTAMPTZ NOT NULL,
        "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
        "capacity" INTEGER NOT NULL DEFAULT 0,
        "seats_taken" INTEGER NOT NULL DEFAULT 0,
        "waitlist_enabled" BOOLEAN NOT NULL DEFAULT false,
        "price_amount" INTEGER NULL,
        "currency_code" TEXT NULL,
        "early_bird_amount" INTEGER NULL,
        "early_bird_until" TIMESTAMPTZ NULL,
        "location_type" TEXT NOT NULL DEFAULT 'video',
        "location_detail" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'scheduled',
        "recording_url" TEXT NULL,
        "matrix_room_id" TEXT NULL,
        "is_embeddable" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_class_event_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_class_event_seller_starts" ON "wellness_class_event" ("seller_id","starts_at") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_class_event_product_id" ON "wellness_class_event" ("product_id") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_class_attendee -----------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_class_attendee" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "class_event_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "customer_email" TEXT NOT NULL,
        "customer_name" TEXT NULL,
        "order_id" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'registered',
        "used_membership_credit" BOOLEAN NOT NULL DEFAULT false,
        "checked_in_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_class_attendee_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_class_attendee_class_event_id" ON "wellness_class_attendee" ("class_event_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_class_attendee_seller_id" ON "wellness_class_attendee" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_class_attendee_order_id" ON "wellness_class_attendee" ("order_id") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_client_profile -----------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_client_profile" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "email" TEXT NOT NULL,
        "name" TEXT NULL,
        "phone" TEXT NULL,
        "location" TEXT NULL,
        "pronouns" TEXT NULL,
        "tags" JSONB NULL,
        "referral_source" TEXT NULL,
        "first_seen_at" TIMESTAMPTZ NULL,
        "last_seen_at" TIMESTAMPTZ NULL,
        "lifetime_value_amount" INTEGER NOT NULL DEFAULT 0,
        "total_bookings" INTEGER NOT NULL DEFAULT 0,
        "no_show_count" INTEGER NOT NULL DEFAULT 0,
        "matrix_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_client_profile_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_client_profile_seller_id" ON "wellness_client_profile" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wellness_client_profile_seller_email" ON "wellness_client_profile" ("seller_id","email") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_client_note --------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_client_note" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "client_profile_id" TEXT NOT NULL,
        "booking_id" TEXT NULL,
        "body" TEXT NOT NULL,
        "is_private" BOOLEAN NOT NULL DEFAULT true,
        "author_member_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_client_note_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_client_note_client_profile_id" ON "wellness_client_note" ("client_profile_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_client_note_seller_id" ON "wellness_client_note" ("seller_id") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_intake_form --------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_intake_form" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "fields" JSONB NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_intake_form_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_intake_form_seller_id" ON "wellness_intake_form" ("seller_id") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_intake_response ----------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_intake_response" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "intake_form_id" TEXT NOT NULL,
        "client_profile_id" TEXT NULL,
        "booking_id" TEXT NULL,
        "class_attendee_id" TEXT NULL,
        "answers" JSONB NOT NULL,
        "submitted_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_intake_response_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_intake_response_form_id" ON "wellness_intake_response" ("intake_form_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_intake_response_seller_id" ON "wellness_intake_response" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_intake_response_booking_id" ON "wellness_intake_response" ("booking_id") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_membership_tier ----------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_membership_tier" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "product_id" TEXT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NULL,
        "price_amount" INTEGER NOT NULL DEFAULT 0,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "interval" TEXT NOT NULL DEFAULT 'monthly',
        "credits_per_period" INTEGER NOT NULL DEFAULT 0,
        "credits_roll_over" BOOLEAN NOT NULL DEFAULT false,
        "discount_pct" INTEGER NOT NULL DEFAULT 0,
        "perks" JSONB NULL,
        "blackout_room_alias" TEXT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "display_order" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_membership_tier_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_membership_tier_seller_id" ON "wellness_membership_tier" ("seller_id") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_member -------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_member" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "membership_tier_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "email" TEXT NOT NULL,
        "name" TEXT NULL,
        "subscription_id" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'active',
        "credits_balance" INTEGER NOT NULL DEFAULT 0,
        "credits_used_this_period" INTEGER NOT NULL DEFAULT 0,
        "credits_allocated_total" INTEGER NOT NULL DEFAULT 0,
        "joined_at" TIMESTAMPTZ NULL,
        "current_period_end" TIMESTAMPTZ NULL,
        "cancelled_at" TIMESTAMPTZ NULL,
        "ltv_amount" INTEGER NOT NULL DEFAULT 0,
        "blackout_room_invited" BOOLEAN NOT NULL DEFAULT false,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_member_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_member_seller_id" ON "wellness_member" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wellness_member_subscription_id" ON "wellness_member" ("subscription_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wellness_member_seller_email" ON "wellness_member" ("seller_id","email") WHERE "deleted_at" IS NULL;`)

    // ---- wellness_automation_template ------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wellness_automation_template" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "trigger" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "channel" TEXT NOT NULL DEFAULT 'matrix',
        "enabled" BOOLEAN NOT NULL DEFAULT false,
        "offset_minutes" INTEGER NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wellness_automation_template_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wellness_automation_template_seller_trigger" ON "wellness_automation_template" ("seller_id","trigger") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "wellness_automation_template";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_member";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_membership_tier";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_intake_response";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_intake_form";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_client_note";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_client_profile";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_class_attendee";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_class_event";`)
    this.addSql(`DROP TABLE IF EXISTS "wellness_session_type";`)
  }
}
