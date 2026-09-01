import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: add device_push_token.seller_id, and drop the non-partial
 * UNIQUE constraint on token.
 *
 * seller_id lets one device receive seller-targeted pushes (new order,
 * order cancelled) after signing into the in-app vendor surface. It is
 * independent of customer_id — the same phone can be both a shopper and a
 * seller.
 *
 * The UNIQUE fix is a latent-bug repair. The create migration declared
 * `"token" TEXT NOT NULL UNIQUE` inline AND a partial unique index scoped
 * to `deleted_at IS NULL`. The inline constraint ignores soft deletes, so
 * a sign-out (which soft-deletes the row) followed by a re-registration of
 * the same device threw a unique violation instead of reviving the row.
 * That path had no callers before the vendor surface added sign-out; it
 * does now. The partial index already provides the intended guarantee.
 */
export class Migration20260901AddSellerIdToDevicePushToken extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "device_push_token"
      ADD COLUMN IF NOT EXISTS "seller_id" TEXT NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_device_push_token_seller_id"
      ON "device_push_token" ("seller_id")
      WHERE "deleted_at" IS NULL;
    `)

    // Postgres names an inline column UNIQUE as <table>_<column>_key.
    this.addSql(`
      ALTER TABLE "device_push_token"
      DROP CONSTRAINT IF EXISTS "device_push_token_token_key";
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP INDEX IF EXISTS "IDX_device_push_token_seller_id";
    `)
    this.addSql(`
      ALTER TABLE "device_push_token"
      DROP COLUMN IF EXISTS "seller_id";
    `)
    // The dropped UNIQUE constraint is deliberately NOT recreated: the
    // partial unique index from the create migration is the correct
    // guarantee, and restoring the constraint would reintroduce the bug.
  }
}
