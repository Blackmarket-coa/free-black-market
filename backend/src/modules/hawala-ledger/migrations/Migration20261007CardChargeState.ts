import { Migration } from "@mikro-orm/migrations"

/**
 * `hawala_card_charge_state` (SD-43, `../models/card-charge-state.ts`): what
 * Stripe reports for each FBM card charge after capture — refunded, lost to
 * a dispute, or held by an open one — re-read from Stripe on every charge
 * and dispute event. One row per charge (partial unique index). Typed from
 * the model (`number` => INTEGER, `dateTime` => TIMESTAMPTZ). No balance
 * column; nothing here moves money.
 */
export class Migration20261007CardChargeState extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_card_charge_state" (
        "id" TEXT NOT NULL,
        "stripe_charge_id" TEXT NOT NULL,
        "payment_intent_id" TEXT NULL,
        "payment_id" TEXT NOT NULL,
        "payment_collection_id" TEXT NOT NULL,
        "currency_code" TEXT NOT NULL,
        "amount_cents" INTEGER NOT NULL,
        "refunded_cents" INTEGER NOT NULL DEFAULT 0,
        "dispute_lost_cents" INTEGER NOT NULL DEFAULT 0,
        "dispute_open_cents" INTEGER NOT NULL DEFAULT 0,
        "synced_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_card_charge_state_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_card_charge_state_cents_check" CHECK (
          "amount_cents" >= 0 AND "refunded_cents" >= 0 AND "dispute_lost_cents" >= 0 AND "dispute_open_cents" >= 0
        )
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_card_charge_state_charge"
      ON "hawala_card_charge_state" ("stripe_charge_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_hawala_card_charge_state_collection"
      ON "hawala_card_charge_state" ("payment_collection_id")
      WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_card_charge_state_collection";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_hawala_card_charge_state_charge";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_card_charge_state" CASCADE;`)
  }
}
