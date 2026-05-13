import { Migration } from "@mikro-orm/migrations"

/**
 * Base table for the payout-breakdown module. Previously the schema
 * relied on Medusa's first-boot model sync to create the table, which
 * worked at runtime but left integration tests (TI-1) failing because
 * later ALTER migrations in this module run before the sync has had a
 * chance to materialise the table.
 *
 * Columns mirror `models/order-payout-breakdown.ts` at the point this
 * module was first introduced. Every bigNumber field has both a
 * NUMERIC scalar and a `raw_*` JSONB sibling (BigNumber storage
 * convention used by Medusa core).
 *
 * Subsequent ALTER migrations in this module (Add*PluginAndReferralSplits,
 * AddCreatorCommission, AddReferrerLevels) use `ADD COLUMN IF NOT EXISTS`
 * and therefore harmlessly no-op against this baseline.
 */
export class Migration20260101000000CreateOrderPayoutBreakdown extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "order_payout_breakdown" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "order_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "customer_paid" NUMERIC NOT NULL,
        "raw_customer_paid" JSONB,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "breakdown_items" JSONB NOT NULL,
        "total_to_producers" NUMERIC NOT NULL,
        "raw_total_to_producers" JSONB,
        "total_platform_fees" NUMERIC NOT NULL,
        "raw_total_platform_fees" JSONB,
        "total_payment_processing" NUMERIC NOT NULL,
        "raw_total_payment_processing" JSONB,
        "total_delivery" NUMERIC NOT NULL DEFAULT 0,
        "raw_total_delivery" JSONB,
        "total_community_fund" NUMERIC NOT NULL DEFAULT 0,
        "raw_total_community_fund" JSONB,
        "total_tax" NUMERIC NOT NULL DEFAULT 0,
        "raw_total_tax" JSONB,
        "total_tip" NUMERIC NOT NULL DEFAULT 0,
        "raw_total_tip" JSONB,
        "seller_breakdown" JSONB NOT NULL,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_opb_order_id_unique"
        ON "order_payout_breakdown" ("order_id")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_opb_order_id"
        ON "order_payout_breakdown" ("order_id");
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_opb_customer_id"
        ON "order_payout_breakdown" ("customer_id");
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_opb_created_at"
        ON "order_payout_breakdown" ("created_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "order_payout_breakdown";`)
  }
}
