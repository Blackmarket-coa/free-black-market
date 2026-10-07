import { Migration } from "@mikro-orm/migrations"

/**
 * `hawala_payout_request` and `hawala_vendor_payment` declare columns their
 * migrations never created (SD-42, the same class of drift
 * Migration20260904AddLedgerEntryModelColumns closed on `hawala_ledger_entry`
 * and Migration20261004PoolCarrier on the pool tables). On a database built
 * from its own migrations the generated CRUD could not insert either row, so
 * `requestPayout` (the vendor panel's payout button, and the monthly grower
 * payout) and `createVendorToVendorPayment` failed on their first write,
 * after the request had been validated: "column "ledger_account_id" of
 * relation "hawala_payout_request" does not exist". No test saw it: the
 * unit specs shadow the writes, and the module runners build their schema
 * from the models. Found by the SD-40 real-database spec, which pays a
 * vendor out through `requestPayout`.
 *
 *   - `hawala_payout_request`: the model's `ledger_account_id`,
 *     `payout_method`, `gross_amount`, `fee_rate`, `fee_details`,
 *     `stripe_payout_id`, `stripe_transfer_id`, `requested_at`,
 *     `completed_at`, `estimated_arrival`, `failure_code` (+ the two `raw_*`
 *     companions). The legacy `amount` NOT NULL, which the model never writes
 *     (it writes `gross_amount`), is dropped, or every insert still fails.
 *   - `hawala_vendor_payment`: `payer_ledger_account_id`,
 *     `payee_ledger_account_id`, `currency_code` (model default 'USD', so
 *     MikroORM includes it in every insert), `purchase_order_number`.
 *
 * Column adds only, each `IF NOT EXISTS`, typed from the model per
 * Migration20251230's convention (`bigNumber` => NUMERIC(20,4) + `raw_*`
 * JSONB; enums => TEXT; `dateTime` => TIMESTAMPTZ). Model-required columns are
 * added NULLABLE: no value can be invented for rows that might exist, and the
 * model always writes them. A no-op on a database that already carries them.
 * `down()` drops only what this adds; the `DROP NOT NULL` is not reversed
 * (re-adding it to a column that now holds nulls would fail).
 */
export class Migration20261007PayoutRequestVendorPaymentDrift extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_payout_request"
        ADD COLUMN IF NOT EXISTS "ledger_account_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "payout_method" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "gross_amount" NUMERIC(20,4) NULL,
        ADD COLUMN IF NOT EXISTS "raw_gross_amount" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "fee_rate" NUMERIC(20,4) NULL,
        ADD COLUMN IF NOT EXISTS "raw_fee_rate" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "fee_details" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "stripe_payout_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "stripe_transfer_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "requested_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "estimated_arrival" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "failure_code" TEXT NULL;
    `)
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hawala_payout_request' AND column_name = 'amount' AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE "hawala_payout_request" ALTER COLUMN "amount" DROP NOT NULL;
        END IF;
      END $$;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_payout_request_account"
      ON "hawala_payout_request" ("ledger_account_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_payout_request_stripe"
      ON "hawala_payout_request" ("stripe_payout_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      ALTER TABLE "hawala_vendor_payment"
        ADD COLUMN IF NOT EXISTS "payer_ledger_account_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "payee_ledger_account_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "currency_code" TEXT NOT NULL DEFAULT 'USD',
        ADD COLUMN IF NOT EXISTS "purchase_order_number" TEXT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_payout_request_stripe";`)
    this.addSql(`DROP INDEX IF EXISTS "idx_payout_request_account";`)
    for (const col of [
      "failure_code",
      "estimated_arrival",
      "completed_at",
      "requested_at",
      "stripe_transfer_id",
      "stripe_payout_id",
      "fee_details",
      "raw_fee_rate",
      "fee_rate",
      "raw_gross_amount",
      "gross_amount",
      "payout_method",
      "ledger_account_id",
    ]) {
      this.addSql(`ALTER TABLE "hawala_payout_request" DROP COLUMN IF EXISTS "${col}";`)
    }
    for (const col of ["purchase_order_number", "currency_code", "payee_ledger_account_id", "payer_ledger_account_id"]) {
      this.addSql(`ALTER TABLE "hawala_vendor_payment" DROP COLUMN IF EXISTS "${col}";`)
    }
  }
}
