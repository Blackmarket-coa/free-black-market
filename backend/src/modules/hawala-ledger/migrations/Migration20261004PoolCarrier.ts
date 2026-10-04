import { Migration } from "@mikro-orm/migrations"

/**
 * Nonprofit-carried investment pools (docs/BMC_SURVIVAL_PROGRAMS.md Decision
 * 6b; legal checkpoint L26) — Phase 1b slice S12.
 *
 * ## Part 1 — reconcile pre-existing model/DDL drift, additively
 *
 * `Migration20251229CreateHawalaLedger` created `hawala_investment_pool` and
 * `hawala_investment` with columns the models never declared
 * (`current_amount`, `min_investment`, `investor_id`, `return_amount`, ...)
 * and WITHOUT most of the columns they do declare (`total_raised`,
 * `minimum_investment`, `investor_account_id`, `ledger_entry_id`,
 * `invested_at`, ...). `Migration20251230AddRawColumns` then added `raw_*`
 * companions for the wrong set. On a migration-built database the generated
 * CRUD could not insert a pool or an investment, and `atomicPoolIncrement`'s
 * `UPDATE ... total_raised = total_raised + ?` had no column to update. No
 * test saw it: the module runners build their schema from the models.
 * `Migration20260904AddLedgerEntryModelColumns` fixed the same class of drift
 * on `hawala_ledger_entry` and missed these two tables.
 *
 * Every 1b column below is an ALTER on these tables, so the drift must be
 * closed first or the 1b ALTERs themselves (e.g. `investor_account_id DROP NOT
 * NULL`) fail on a column that does not exist. Column adds only, each `IF NOT
 * EXISTS`, typed from the model per Migration20251230's convention
 * (`bigNumber` => NUMERIC(20,4) + `raw_*` JSONB; `float` => REAL; enums =>
 * TEXT + CHECK; `dateTime` => TIMESTAMPTZ; `number` => INTEGER). A no-op on a
 * database that already carries them (from `db:generate` or by hand).
 *
 * One legacy NOT NULL the model never writes — `hawala_investment.investor_id`
 * — is made nullable (guarded), or every insert the model produces still fails.
 *
 * ## Part 2 — the 1b additions
 *
 *   - `hawala_investment_pool.carrier_org_key` TEXT NULL (points at
 *     `partner_org.key` by key, like `fiscal_host_key`; no cross-module FK) and
 *     `carrier_snapshot` JSONB NULL (the frozen, L11-dated snapshot).
 *   - `hawala_investment.settlement` TEXT NOT NULL DEFAULT 'LEDGER' CHECK
 *     (LEDGER | CARRIER), `carrier_org_key`, `carrier_reference`;
 *     `investor_account_id` DROP NOT NULL (a CARRIER record has no account);
 *     a CHECK that a CARRIER row carries its carrier + reference and NO
 *     account and NO ledger entry — the posture in the schema, last line.
 *   - partial unique index (pool_id, carrier_reference) WHERE deleted_at IS
 *     NULL AND carrier_reference IS NOT NULL: the idempotency key for carried
 *     contributions; two concurrent records of the same carrier reference
 *     cannot both insert.
 *   - `hawala_pool_carrier_distribution`: record-only carrier payouts, same
 *     partial unique index. No balance column anywhere.
 *
 * No `ALTER TYPE ... ADD VALUE`: the vocabularies are TEXT + CHECK, so nothing
 * depends on the Postgres version.
 *
 * `down()` drops ONLY the 1b additions. The Part 1 columns are left in place:
 * they are model-owned, and dropping them would destroy the data the model
 * has been writing to them. The `DROP NOT NULL`s are not reversed either —
 * re-adding NOT NULL to a column that now holds nulls would fail or, worse,
 * require inventing values.
 */
export class Migration20261004PoolCarrier extends Migration {
  async up(): Promise<void> {
    // ── Part 1: hawala_investment_pool drift ──────────────────────────────
    this.addSql(`
      ALTER TABLE "hawala_investment_pool"
        ADD COLUMN IF NOT EXISTS "minimum_investment" NUMERIC(20,4) NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "raw_minimum_investment" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "maximum_investment" NUMERIC(20,4) NULL,
        ADD COLUMN IF NOT EXISTS "raw_maximum_investment" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "roi_type" TEXT NOT NULL DEFAULT 'REVENUE_SHARE',
        ADD COLUMN IF NOT EXISTS "roi_rate" REAL NULL,
        ADD COLUMN IF NOT EXISTS "fixed_roi_rate" REAL NULL,
        ADD COLUMN IF NOT EXISTS "revenue_share_percentage" REAL NULL,
        ADD COLUMN IF NOT EXISTS "product_credit_multiplier" REAL NULL,
        ADD COLUMN IF NOT EXISTS "start_date" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "end_date" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "fundraising_start" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "fundraising_end" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "total_raised" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_total_raised" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "total_investors" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "total_distributed" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_total_distributed" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "auto_invest_enabled" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "auto_invest_percentage" REAL NULL,
        ADD COLUMN IF NOT EXISTS "cover_image" TEXT NULL;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_investment_pool"
        ADD CONSTRAINT "hawala_investment_pool_roi_type_check"
          CHECK ("roi_type" IN ('FIXED_RATE','REVENUE_SHARE','PRODUCT_CREDIT','HYBRID'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    // ── Part 1: hawala_investment drift ───────────────────────────────────
    this.addSql(`
      ALTER TABLE "hawala_investment"
        ADD COLUMN IF NOT EXISTS "investor_account_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "customer_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "currency_code" TEXT NOT NULL DEFAULT 'USD',
        ADD COLUMN IF NOT EXISTS "expected_return" NUMERIC(20,4) NULL,
        ADD COLUMN IF NOT EXISTS "raw_expected_return" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "actual_return" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_actual_return" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "return_distributed" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_return_distributed" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'DIRECT',
        ADD COLUMN IF NOT EXISTS "source_order_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "ledger_entry_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "invested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "matured_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "withdrawn_at" TIMESTAMPTZ NULL;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_investment"
        ADD CONSTRAINT "hawala_investment_source_check"
          CHECK ("source" IN ('DIRECT','AUTO_ORDER','GIFT'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    // Legacy NOT NULL the model never writes: without this, every insert the
    // model produces still fails on a migration-built database.
    this.addSql(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hawala_investment' AND column_name = 'investor_id'
        ) THEN
          ALTER TABLE "hawala_investment" ALTER COLUMN "investor_id" DROP NOT NULL;
        END IF;
      END $$;
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_investment_pool_status" ON "hawala_investment" ("pool_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_investment_customer" ON "hawala_investment" ("customer_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_investment_account" ON "hawala_investment" ("investor_account_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_investment_pool_producer" ON "hawala_investment_pool" ("producer_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_investment_pool_account" ON "hawala_investment_pool" ("ledger_account_id");`)

    // ── Part 2: the carrier ───────────────────────────────────────────────
    this.addSql(`
      ALTER TABLE "hawala_investment_pool"
        ADD COLUMN IF NOT EXISTS "carrier_org_key" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "carrier_snapshot" JSONB NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_hawala_investment_pool_carrier_org_key"
      ON "hawala_investment_pool" ("carrier_org_key")
      WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      ALTER TABLE "hawala_investment"
        ADD COLUMN IF NOT EXISTS "settlement" TEXT NOT NULL DEFAULT 'LEDGER',
        ADD COLUMN IF NOT EXISTS "carrier_org_key" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "carrier_reference" TEXT NULL;
    `)
    // A CARRIER record has no BMC account to debit. Guarded: the column was
    // added above IF NOT EXISTS, but on a database where it pre-exists NOT NULL
    // (built from the model) this is the ALTER that matters.
    this.addSql(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hawala_investment' AND column_name = 'investor_account_id'
        ) THEN
          ALTER TABLE "hawala_investment" ALTER COLUMN "investor_account_id" DROP NOT NULL;
        END IF;
      END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_investment"
        ADD CONSTRAINT "hawala_investment_settlement_check"
          CHECK ("settlement" IN ('LEDGER','CARRIER'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    // The posture, in the schema: a carried record names its carrier and the
    // carrier's reference, and has touched neither a BMC account nor a ledger
    // entry. Whatever code writes the row.
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_investment"
        ADD CONSTRAINT "hawala_investment_carrier_shape_check"
          CHECK (
            "settlement" <> 'CARRIER'
            OR (
              "carrier_org_key" IS NOT NULL
              AND "carrier_reference" IS NOT NULL
              AND "investor_account_id" IS NULL
              AND "ledger_entry_id" IS NULL
            )
          );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_investment_pool_carrier_reference"
      ON "hawala_investment" ("pool_id", "carrier_reference")
      WHERE "deleted_at" IS NULL AND "carrier_reference" IS NOT NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_pool_carrier_distribution" (
        "id" TEXT NOT NULL,
        "pool_id" TEXT NOT NULL,
        "carrier_org_key" TEXT NOT NULL,
        "carrier_reference" TEXT NOT NULL,
        "amount" NUMERIC(20,4) NOT NULL,
        "raw_amount" JSONB NULL,
        "distributed_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_pool_carrier_distribution_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_pool_carrier_distribution_amount_positive_check"
          CHECK ("amount" > 0)
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_hawala_pool_carrier_distribution_pool"
      ON "hawala_pool_carrier_distribution" ("pool_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_pool_carrier_distribution_reference"
      ON "hawala_pool_carrier_distribution" ("pool_id", "carrier_reference")
      WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    // Only the 1b additions. Part 1's reconciled columns stay (model-owned
    // data); the DROP NOT NULLs are not reversed (see the header).
    this.addSql(`DROP INDEX IF EXISTS "UQ_hawala_pool_carrier_distribution_reference";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_pool_carrier_distribution_pool";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_pool_carrier_distribution" CASCADE;`)

    this.addSql(`DROP INDEX IF EXISTS "UQ_hawala_investment_pool_carrier_reference";`)
    this.addSql(`ALTER TABLE "hawala_investment" DROP CONSTRAINT IF EXISTS "hawala_investment_carrier_shape_check";`)
    this.addSql(`ALTER TABLE "hawala_investment" DROP CONSTRAINT IF EXISTS "hawala_investment_settlement_check";`)
    this.addSql(`ALTER TABLE "hawala_investment" DROP COLUMN IF EXISTS "carrier_reference";`)
    this.addSql(`ALTER TABLE "hawala_investment" DROP COLUMN IF EXISTS "carrier_org_key";`)
    this.addSql(`ALTER TABLE "hawala_investment" DROP COLUMN IF EXISTS "settlement";`)

    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_investment_pool_carrier_org_key";`)
    this.addSql(`ALTER TABLE "hawala_investment_pool" DROP COLUMN IF EXISTS "carrier_snapshot";`)
    this.addSql(`ALTER TABLE "hawala_investment_pool" DROP COLUMN IF EXISTS "carrier_org_key";`)
  }
}
