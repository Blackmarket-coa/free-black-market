import { Migration } from "@mikro-orm/migrations"

/**
 * Adds the checkout-bridge columns to `creator_listing` (W1b).
 *
 * - `product_id` / `variant_id`: a priced listing can only enter a Medusa
 *   cart through a product variant, so the Blackout checkout materializes a
 *   shadow product per listing and records the link here. Nullable —
 *   artifact-only listings never get one.
 * - `interval` / `period_days`: the recurrence shape for
 *   category:"subscription" listings. `category` alone was display taxonomy;
 *   these drive the subscription record (interval) and the entitlement
 *   window (`expires_at = next_order_date`).
 */
export class Migration20260830AddListingProductAndRecurrence extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "creator_listing"
        ADD COLUMN IF NOT EXISTS "product_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "variant_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "interval" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "period_days" INTEGER NULL;
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_creator_listing_product_id" ON "creator_listing" ("product_id") WHERE "product_id" IS NOT NULL AND "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_creator_listing_product_id";`)
    this.addSql(`
      ALTER TABLE "creator_listing"
        DROP COLUMN IF EXISTS "product_id",
        DROP COLUMN IF EXISTS "variant_id",
        DROP COLUMN IF EXISTS "interval",
        DROP COLUMN IF EXISTS "period_days";
    `)
  }
}
