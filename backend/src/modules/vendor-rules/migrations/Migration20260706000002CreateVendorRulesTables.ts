import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Create the four vendor-rules model tables that had no migration (finding
 * B-mig-1): `vendor_rules`, `vendor_customer_tier`, `fulfillment_window`, and
 * `standing_order`. The module's only prior migration created just
 * `wholesale_application`, so wholesale-tier approval and the nursery/standing-
 * order routes 500'd with "relation does not exist".
 *
 * Columns mirror the model definitions. `model.number()` uses INTEGER (matching
 * the sibling wholesale_application migration); `model.bigNumber()` uses NUMERIC
 * with a `raw_*` JSONB sibling (Medusa BigNumber storage convention).
 */
export class Migration20260706000002CreateVendorRulesTables extends Migration {
  override async up(): Promise<void> {
    // === vendor_rules ===
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_rules" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "seller_id" TEXT NOT NULL,
        "min_order_value" INTEGER NOT NULL DEFAULT 0,
        "min_order_items" INTEGER NOT NULL DEFAULT 1,
        "allowed_fulfillment_methods" JSONB NOT NULL,
        "lead_time_hours" INTEGER NOT NULL DEFAULT 24,
        "max_delivery_distance" INTEGER NOT NULL DEFAULT 0,
        "delivery_days" JSONB,
        "pickup_days" JSONB,
        "allow_direct_messages" BOOLEAN NOT NULL DEFAULT true,
        "require_order_context" BOOLEAN NOT NULL DEFAULT false,
        "auto_respond_enabled" BOOLEAN NOT NULL DEFAULT false,
        "auto_respond_message" TEXT,
        "allow_price_negotiation" BOOLEAN NOT NULL DEFAULT false,
        "negotiation_min_quantity" INTEGER NOT NULL DEFAULT 10,
        "profile_visible" BOOLEAN NOT NULL DEFAULT true,
        "products_searchable" BOOLEAN NOT NULL DEFAULT true,
        "show_in_directory" BOOLEAN NOT NULL DEFAULT true,
        "max_orders_per_day" INTEGER NOT NULL DEFAULT 0,
        "max_orders_per_week" INTEGER NOT NULL DEFAULT 0,
        "accepting_orders" BOOLEAN NOT NULL DEFAULT true,
        "pause_message" TEXT,
        "resume_date" TIMESTAMPTZ,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_rules_seller_id_unique"
        ON "vendor_rules" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_rules_deleted_at"
        ON "vendor_rules" ("deleted_at") WHERE "deleted_at" IS NULL;
    `)

    // === vendor_customer_tier ===
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_customer_tier" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "seller_id" TEXT NOT NULL,
        "tier_type" TEXT NOT NULL
          CHECK ("tier_type" IN ('REGULAR','PREFERRED','WHOLESALE','RESTAURANT','COOP_MEMBER')),
        "name" TEXT NOT NULL,
        "description" TEXT,
        "discount_percent" INTEGER NOT NULL DEFAULT 0,
        "waive_order_minimum" BOOLEAN NOT NULL DEFAULT false,
        "priority_fulfillment" BOOLEAN NOT NULL DEFAULT false,
        "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
        "free_delivery_threshold" INTEGER NOT NULL DEFAULT 0,
        "min_monthly_order" INTEGER NOT NULL DEFAULT 0,
        "requires_application" BOOLEAN NOT NULL DEFAULT false,
        "customer_ids" JSONB,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vct_seller_id"
        ON "vendor_customer_tier" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vct_tier_type"
        ON "vendor_customer_tier" ("tier_type") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_customer_tier_deleted_at"
        ON "vendor_customer_tier" ("deleted_at") WHERE "deleted_at" IS NULL;
    `)

    // === fulfillment_window ===
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "fulfillment_window" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "seller_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "fulfillment_type" TEXT NOT NULL
          CHECK ("fulfillment_type" IN ('DELIVERY','PICKUP','SHIPPING')),
        "day_of_week" INTEGER NOT NULL,
        "start_time" TEXT NOT NULL,
        "end_time" TEXT NOT NULL,
        "capacity" INTEGER NOT NULL DEFAULT 0,
        "current_bookings" INTEGER NOT NULL DEFAULT 0,
        "cutoff_hours" INTEGER NOT NULL DEFAULT 24,
        "additional_fee" INTEGER NOT NULL DEFAULT 0,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "pickup_location" TEXT,
        "pickup_instructions" TEXT,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_fw_seller_id"
        ON "fulfillment_window" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_fw_type"
        ON "fulfillment_window" ("fulfillment_type") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_fw_day"
        ON "fulfillment_window" ("day_of_week") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_window_deleted_at"
        ON "fulfillment_window" ("deleted_at") WHERE "deleted_at" IS NULL;
    `)

    // === standing_order ===
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "standing_order" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "seller_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "frequency" TEXT NOT NULL
          CHECK ("frequency" IN ('WEEKLY','BIWEEKLY','MONTHLY','CUSTOM')),
        "day_of_week" INTEGER,
        "day_of_month" INTEGER,
        "custom_frequency_days" INTEGER,
        "start_date" TIMESTAMPTZ NOT NULL,
        "end_date" TIMESTAMPTZ,
        "next_order_date" TIMESTAMPTZ,
        "line_items" JSONB NOT NULL,
        "order_value" NUMERIC NOT NULL,
        "raw_order_value" JSONB,
        "fulfillment_method" TEXT NOT NULL,
        "fulfillment_window_id" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE'
          CHECK ("status" IN ('ACTIVE','PAUSED','CANCELLED','COMPLETED')),
        "pause_reason" TEXT,
        "orders_generated" INTEGER NOT NULL DEFAULT 0,
        "total_fulfilled_value" NUMERIC NOT NULL DEFAULT 0,
        "raw_total_fulfilled_value" JSONB,
        "last_order_date" TIMESTAMPTZ,
        "order_ids" JSONB,
        "customer_notes" TEXT,
        "vendor_notes" TEXT,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_so_seller_id"
        ON "standing_order" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_so_customer_id"
        ON "standing_order" ("customer_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_so_status"
        ON "standing_order" ("status") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_so_next_order"
        ON "standing_order" ("next_order_date") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_standing_order_deleted_at"
        ON "standing_order" ("deleted_at") WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "standing_order" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "fulfillment_window" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "vendor_customer_tier" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "vendor_rules" CASCADE;`)
  }
}
