import { Migration } from "@mikro-orm/migrations"

export class Migration20260306113000AddPayoutAndOracleReceipts extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "prediction_payout_status_enum" AS ENUM ('computed','credited','failed','retried','reversed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "prediction_payout_entry" (
        "id" TEXT NOT NULL,
        "settlement_id" TEXT NOT NULL,
        "market_id" TEXT NOT NULL,
        "position_id" TEXT NOT NULL,
        "supporter_id" TEXT NOT NULL,
        "payout_amount" NUMERIC NOT NULL DEFAULT 0,
        "payout_unit" TEXT NOT NULL DEFAULT 'points',
        "payout_status" prediction_payout_status_enum NOT NULL DEFAULT 'computed',
        "is_winner" BOOLEAN NOT NULL DEFAULT false,
        "failure_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "prediction_payout_entry_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_payout_settlement" ON "prediction_payout_entry" ("settlement_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_payout_market_supporter" ON "prediction_payout_entry" ("market_id", "supporter_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_payout_status" ON "prediction_payout_entry" ("payout_status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prediction_payout_unique_position" ON "prediction_payout_entry" ("settlement_id", "position_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "oracle_verification_receipt" (
        "id" TEXT NOT NULL,
        "market_id" TEXT NOT NULL,
        "settlement_ref" TEXT NOT NULL,
        "key_id" TEXT NOT NULL,
        "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
        "nonce" TEXT NOT NULL,
        "payload_hash" TEXT NOT NULL,
        "signature" TEXT NOT NULL,
        "signature_verified" BOOLEAN NOT NULL DEFAULT false,
        "signed_at" TIMESTAMPTZ NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "oracle_verification_receipt_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_oracle_receipt_market" ON "oracle_verification_receipt" ("market_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_oracle_receipt_settlement_ref" ON "oracle_verification_receipt" ("settlement_ref") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_oracle_receipt_key_id" ON "oracle_verification_receipt" ("key_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_oracle_receipt_nonce" ON "oracle_verification_receipt" ("nonce") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "oracle_verification_receipt" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "prediction_payout_entry" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "prediction_payout_status_enum";')
  }
}
