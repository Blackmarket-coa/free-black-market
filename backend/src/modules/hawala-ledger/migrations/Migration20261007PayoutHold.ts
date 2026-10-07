import { Migration } from "@mikro-orm/migrations"

/**
 * `hawala_payout_hold` (SD-40, `../models/payout-hold.ts`): a record that a
 * seller's payouts are held while a refund on a shared Mercur cart is not yet
 * assigned to any seller's order. Typed from the model per
 * Migration20251230's convention (`bigNumber` => NUMERIC(20,4) + `raw_*`
 * JSONB; enums => TEXT + CHECK; `dateTime` => TIMESTAMPTZ). The partial
 * unique index allows one ACTIVE hold per (seller, collection, reason), so a
 * second reconciler run, or two at once, never stacks holds. No balance
 * column; nothing here moves money.
 */
export class Migration20261007PayoutHold extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_payout_hold" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "reason" TEXT NOT NULL,
        "payment_collection_id" TEXT NOT NULL,
        "amount" NUMERIC(20,4) NOT NULL,
        "raw_amount" JSONB NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "placed_at" TIMESTAMPTZ NOT NULL,
        "released_at" TIMESTAMPTZ NULL,
        "released_by" TEXT NULL,
        "release_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_payout_hold_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_payout_hold_status_check" CHECK ("status" IN ('ACTIVE', 'RELEASED')),
        CONSTRAINT "hawala_payout_hold_amount_nonnegative_check" CHECK ("amount" >= 0)
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_hawala_payout_hold_seller_status"
      ON "hawala_payout_hold" ("seller_id", "status")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_hawala_payout_hold_collection_status"
      ON "hawala_payout_hold" ("payment_collection_id", "status")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_payout_hold_active"
      ON "hawala_payout_hold" ("seller_id", "payment_collection_id", "reason")
      WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_hawala_payout_hold_active";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_payout_hold_collection_status";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_payout_hold_seller_status";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_payout_hold" CASCADE;`)
  }
}
