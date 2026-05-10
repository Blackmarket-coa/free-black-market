import { Migration } from "@mikro-orm/migrations"

export class Migration20260510120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "share_box_template" (
        "id" TEXT NOT NULL,
        "coordinator_seller_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NULL,
        "base_price" NUMERIC NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "slots" JSONB NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "share_box_template_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SBT_COORDINATOR" ON "share_box_template" ("coordinator_seller_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SBT_ACTIVE" ON "share_box_template" ("is_active");`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "share_box_subscription" (
        "id" TEXT NOT NULL,
        "share_box_template_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "customer_external_id" TEXT NULL,
        "status" TEXT CHECK ("status" IN ('active', 'paused', 'cancelled')) NOT NULL DEFAULT 'active',
        "slot_overrides" JSONB NULL,
        "starts_at" TIMESTAMPTZ NULL,
        "ends_at" TIMESTAMPTZ NULL,
        "pause_until" TIMESTAMPTZ NULL,
        "cancelled_at" TIMESTAMPTZ NULL,
        "cancelled_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "share_box_subscription_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SBS_TEMPLATE" ON "share_box_subscription" ("share_box_template_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SBS_CUSTOMER" ON "share_box_subscription" ("customer_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SBS_EXTERNAL" ON "share_box_subscription" ("customer_external_id", "status");`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_SBS_TEMPLATE_CUSTOMER" ON "share_box_subscription" ("share_box_template_id", "customer_id") WHERE "customer_id" IS NOT NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_SBS_TEMPLATE_EXTERNAL" ON "share_box_subscription" ("share_box_template_id", "customer_external_id") WHERE "customer_external_id" IS NOT NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "share_box" (
        "id" TEXT NOT NULL,
        "share_box_subscription_id" TEXT NOT NULL,
        "share_box_template_id" TEXT NOT NULL,
        "order_cycle_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "customer_external_id" TEXT NULL,
        "status" TEXT CHECK ("status" IN ('pending', 'allocated', 'packed', 'dispatched', 'skipped', 'cancelled')) NOT NULL DEFAULT 'pending',
        "items" JSONB NOT NULL,
        "total_price" NUMERIC NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "unfilled_slot_keys" JSONB NULL,
        "generated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "allocated_at" TIMESTAMPTZ NULL,
        "dispatched_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "share_box_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SB_SUBSCRIPTION" ON "share_box" ("share_box_subscription_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SB_CYCLE" ON "share_box" ("order_cycle_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SB_CYCLE_STATUS" ON "share_box" ("order_cycle_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SB_CUSTOMER" ON "share_box" ("customer_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_SB_EXTERNAL" ON "share_box" ("customer_external_id");`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_SB_SUBSCRIPTION_CYCLE" ON "share_box" ("share_box_subscription_id", "order_cycle_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "share_box";`)
    this.addSql(`DROP TABLE IF EXISTS "share_box_subscription";`)
    this.addSql(`DROP TABLE IF EXISTS "share_box_template";`)
  }
}
