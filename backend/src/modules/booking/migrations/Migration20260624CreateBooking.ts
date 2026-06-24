import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Create booking module tables.
 *
 *  - product_booking_config : per-product slot parameters (duration, buffer,
 *                             timezone, lead times). Presence ⇒ bookable.
 *  - vendor_availability    : recurring weekly windows (day_of_week + HH:MM).
 *  - booking                : individual appointments (UTC instants + status).
 */
export class Migration20260624CreateBooking extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "product_booking_config" (
        "id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL UNIQUE,
        "seller_id" TEXT NOT NULL,
        "duration_minutes" INTEGER NOT NULL DEFAULT 60,
        "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
        "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
        "advance_days" INTEGER NOT NULL DEFAULT 30,
        "min_notice_hours" INTEGER NOT NULL DEFAULT 24,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "product_booking_config_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_product_booking_config_seller_id"
      ON "product_booking_config" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_product_booking_config_product_id"
      ON "product_booking_config" ("product_id") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_availability" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "day_of_week" INTEGER NOT NULL,
        "start_time" TEXT NOT NULL,
        "end_time" TEXT NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "vendor_availability_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_availability_seller_day"
      ON "vendor_availability" ("seller_id", "day_of_week") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "booking" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL,
        "variant_id" TEXT NULL,
        "order_id" TEXT NULL,
        "customer_id" TEXT NULL,
        "customer_email" TEXT NOT NULL,
        "customer_name" TEXT NULL,
        "starts_at" TIMESTAMPTZ NOT NULL,
        "ends_at" TIMESTAMPTZ NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "notes" TEXT NULL,
        "matrix_room_id" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_booking_seller_starts_at"
      ON "booking" ("seller_id", "starts_at") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_booking_product_starts_at"
      ON "booking" ("product_id", "starts_at") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_booking_order_id"
      ON "booking" ("order_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "booking" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "vendor_availability" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "product_booking_config" CASCADE;')
  }
}
