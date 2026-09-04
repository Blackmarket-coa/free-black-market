import { Migration } from "@mikro-orm/migrations"

/**
 * Fund Accounting: money held under donor intent (opt-in).
 *
 * Balances are never stored — they derive from `fund_transaction` rows — so
 * this migration creates only the terms of each fund and its movements.
 */
export class Migration20260904CreateFundAccounting extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "fund_restriction_enum" AS ENUM ('unrestricted','purpose','time','purpose_and_time','permanent');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "fund_source_enum" AS ENUM ('grant','donation','contract','internal');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "fund_status_enum" AS ENUM ('active','closed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "fund_entry_type_enum" AS ENUM ('award','receipt','expenditure','release','return');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "fund" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "description" TEXT NULL,
        "restriction" fund_restriction_enum NOT NULL DEFAULT 'unrestricted',
        "source" fund_source_enum NOT NULL DEFAULT 'grant',
        "purpose_description" TEXT NULL,
        "designated_program_id" TEXT NULL,
        "spend_from" TIMESTAMPTZ NULL,
        "spend_until" TIMESTAMPTZ NULL,
        "grantor_name" TEXT NULL,
        "grant_reference" TEXT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "status" fund_status_enum NOT NULL DEFAULT 'active',
        "enforce_spend_limit" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "fund_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fund_seller" ON "fund" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fund_seller_code" ON "fund" ("seller_id", "code") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fund_status" ON "fund" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "fund_transaction" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "fund_id" TEXT NOT NULL,
        "entry_type" fund_entry_type_enum NOT NULL,
        "amount_cents" NUMERIC NOT NULL,
        "raw_amount_cents" JSONB NOT NULL DEFAULT '{"value":"0","precision":20}',
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "description" TEXT NULL,
        "program_id" TEXT NULL,
        "reference_type" TEXT NULL,
        "reference_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "fund_transaction_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fund_transaction_fund" ON "fund_transaction" ("fund_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fund_transaction_seller" ON "fund_transaction" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fund_transaction_type" ON "fund_transaction" ("entry_type") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fund_transaction_program" ON "fund_transaction" ("program_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "fund_transaction";`)
    this.addSql(`DROP TABLE IF EXISTS "fund";`)
    this.addSql(`DROP TYPE IF EXISTS "fund_entry_type_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "fund_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "fund_source_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "fund_restriction_enum";`)
  }
}
