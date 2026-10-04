import { Migration } from "@mikro-orm/migrations"

/**
 * Verified nonprofit partner_orgs as VendorAdvance recipients
 * (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a; legal checkpoint L26) — Phase 1b
 * slice S13. Same conventions as Migration20261004PoolCarrier (S12).
 *
 * ## Part 1 — reconcile pre-existing model/DDL drift, additively
 *
 * `Migration20251229CreateHawalaLedger` created `hawala_vendor_advance` and
 * `hawala_advance_repayment` with columns the models never declared
 * (`total_repayment`, `disbursement_entry_id`, `due_date`, `completed_at`,
 * repayment `amount`) and WITHOUT ten of the columns the advance model does
 * declare (`ledger_account_id`, `fee_type`, `fee_cap`, `total_fee_charged`,
 * `repayment_method`, `start_date`, `expected_end_date`, `actual_end_date`,
 * `eligibility_snapshot`, `approved_by`) or any of the repayment model's
 * (`principal_amount`, `fee_amount`, `total_amount`,
 * `outstanding_balance_after`, `repayment_type`, `status`). Two legacy
 * NOT NULLs the models never write — `hawala_vendor_advance.total_repayment`
 * and `hawala_advance_repayment.amount` — made every model insert fail on a
 * migration-built database. No test saw it: the module runners build their
 * schema from the models. Same class of drift Migration20260904 fixed on
 * `hawala_ledger_entry` and S12 fixed on the pool tables.
 *
 * Every 1b column below is an ALTER on these tables, so the drift is closed
 * first. Column adds only, each `IF NOT EXISTS`, typed from the model per
 * Migration20251230's convention (`bigNumber` => NUMERIC(20,4) + `raw_*`
 * JSONB; enums => TEXT + CHECK; `dateTime` => TIMESTAMPTZ; `number` =>
 * INTEGER). The two legacy NOT NULLs are dropped under guarded DO blocks. The
 * two column defaults that drifted from the model (`status` 'PENDING' vs
 * PENDING_APPROVAL, `term_days` 90 vs 30) are realigned; the model always
 * sends both, so no row changes.
 *
 * ## Part 2 — the 1b additions
 *
 *   - `hawala_vendor_advance.recipient_type` TEXT NOT NULL DEFAULT 'SELLER'
 *     CHECK (SELLER | PARTNER_ORG) — every existing row is a SELLER row;
 *     `partner_org_key` TEXT NULL (points at `partner_org.key` by key, like
 *     `fiscal_host_key`; no cross-module FK); `recipient_snapshot` JSONB NULL
 *     (the frozen, L11-dated snapshot); `disbursement_reference` TEXT NULL.
 *   - `vendor_id` and `ledger_account_id` DROP NOT NULL (guarded): an org has
 *     neither — it has NO ledger account, ever.
 *   - a CHECK that a PARTNER_ORG row names its org and snapshot and has NO
 *     vendor and NO ledger account, and that a SELLER row still has its
 *     vendor; a CHECK that a PARTNER_ORG row is ACTIVE or REPAID only with a
 *     `disbursement_reference` — no auto-approve, in the schema.
 *   - `hawala_advance_repayment.external_reference` TEXT NULL with a partial
 *     unique index (advance_id, external_reference) WHERE deleted_at IS NULL
 *     AND external_reference IS NOT NULL: the idempotency key for a MANUAL
 *     repayment recorded on an org advance.
 *
 * No `ALTER TYPE ... ADD VALUE`: every vocabulary is TEXT + CHECK. No new
 * table, no balance column.
 *
 * `down()` drops ONLY the 1b additions. The Part 1 columns stay (model-owned
 * data); the DROP NOT NULLs and default realignments are not reversed.
 */
export class Migration20261004OrgAdvance extends Migration {
  async up(): Promise<void> {
    // ── Part 1: hawala_vendor_advance drift ───────────────────────────────
    this.addSql(`
      ALTER TABLE "hawala_vendor_advance"
        ADD COLUMN IF NOT EXISTS "ledger_account_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "raw_fee_rate" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "fee_type" TEXT NOT NULL DEFAULT 'FACTOR_RATE',
        ADD COLUMN IF NOT EXISTS "fee_cap" NUMERIC(20,4) NULL,
        ADD COLUMN IF NOT EXISTS "raw_fee_cap" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "total_fee_charged" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_total_fee_charged" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "repayment_method" TEXT NOT NULL DEFAULT 'AUTO_DEDUCT',
        ADD COLUMN IF NOT EXISTS "raw_repayment_rate" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "start_date" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "expected_end_date" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "actual_end_date" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "eligibility_snapshot" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "approved_by" TEXT NULL;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_vendor_advance"
        ADD CONSTRAINT "hawala_vendor_advance_fee_type_check"
          CHECK ("fee_type" IN ('FLAT','WEEKLY_PERCENT','FACTOR_RATE'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_vendor_advance"
        ADD CONSTRAINT "hawala_vendor_advance_repayment_method_check"
          CHECK ("repayment_method" IN ('AUTO_DEDUCT','MANUAL','SCHEDULED'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    // Legacy NOT NULL the model never writes: without this, every insert the
    // model produces still fails on a migration-built database.
    this.addSql(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hawala_vendor_advance' AND column_name = 'total_repayment'
        ) THEN
          ALTER TABLE "hawala_vendor_advance" ALTER COLUMN "total_repayment" DROP NOT NULL;
        END IF;
      END $$;
    `)
    // Defaults that drifted from the model (the model always sends both).
    this.addSql(`ALTER TABLE "hawala_vendor_advance" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" ALTER COLUMN "term_days" SET DEFAULT 30;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vendor_advance_vendor_status" ON "hawala_vendor_advance" ("vendor_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vendor_advance_account" ON "hawala_vendor_advance" ("ledger_account_id");`)

    // ── Part 1: hawala_advance_repayment drift ────────────────────────────
    this.addSql(`
      ALTER TABLE "hawala_advance_repayment"
        ADD COLUMN IF NOT EXISTS "principal_amount" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_principal_amount" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "fee_amount" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_fee_amount" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "total_amount" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_total_amount" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "outstanding_balance_after" NUMERIC(20,4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_outstanding_balance_after" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "repayment_type" TEXT NOT NULL DEFAULT 'MANUAL',
        ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'COMPLETED';
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_advance_repayment"
        ADD CONSTRAINT "hawala_advance_repayment_type_check"
          CHECK ("repayment_type" IN ('AUTO_DEDUCT','MANUAL','ADJUSTMENT'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_advance_repayment"
        ADD CONSTRAINT "hawala_advance_repayment_status_check"
          CHECK ("status" IN ('PENDING','COMPLETED','FAILED','REVERSED'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hawala_advance_repayment' AND column_name = 'amount'
        ) THEN
          ALTER TABLE "hawala_advance_repayment" ALTER COLUMN "amount" DROP NOT NULL;
        END IF;
      END $$;
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_advance_repayment_advance" ON "hawala_advance_repayment" ("advance_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_advance_repayment_order" ON "hawala_advance_repayment" ("order_id");`)

    // ── Part 2: the org recipient ─────────────────────────────────────────
    this.addSql(`
      ALTER TABLE "hawala_vendor_advance"
        ADD COLUMN IF NOT EXISTS "recipient_type" TEXT NOT NULL DEFAULT 'SELLER',
        ADD COLUMN IF NOT EXISTS "partner_org_key" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "recipient_snapshot" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "disbursement_reference" TEXT NULL;
    `)
    // An org has no seller and NO ledger account. Guarded: on a database built
    // from the (old) model these columns pre-exist NOT NULL.
    this.addSql(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hawala_vendor_advance' AND column_name = 'vendor_id'
        ) THEN
          ALTER TABLE "hawala_vendor_advance" ALTER COLUMN "vendor_id" DROP NOT NULL;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hawala_vendor_advance' AND column_name = 'ledger_account_id'
        ) THEN
          ALTER TABLE "hawala_vendor_advance" ALTER COLUMN "ledger_account_id" DROP NOT NULL;
        END IF;
      END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_vendor_advance"
        ADD CONSTRAINT "hawala_vendor_advance_recipient_type_check"
          CHECK ("recipient_type" IN ('SELLER','PARTNER_ORG'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    // The posture, in the schema: an org advance names its org and its frozen
    // snapshot and has NO vendor and NO ledger account; a seller advance still
    // has its vendor. Whatever code writes the row.
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_vendor_advance"
        ADD CONSTRAINT "hawala_vendor_advance_recipient_shape_check"
          CHECK (
            ("recipient_type" = 'SELLER' AND "vendor_id" IS NOT NULL)
            OR (
              "recipient_type" = 'PARTNER_ORG'
              AND "partner_org_key" IS NOT NULL
              AND "recipient_snapshot" IS NOT NULL
              AND "vendor_id" IS NULL
              AND "ledger_account_id" IS NULL
            )
          );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    // No auto-approve on the org path: ACTIVE / REPAID only with the
    // operator's disbursement reference.
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_vendor_advance"
        ADD CONSTRAINT "hawala_vendor_advance_org_disbursement_check"
          CHECK (
            "recipient_type" <> 'PARTNER_ORG'
            OR "status" NOT IN ('ACTIVE','REPAID')
            OR "disbursement_reference" IS NOT NULL
          );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_hawala_vendor_advance_org_status"
      ON "hawala_vendor_advance" ("partner_org_key", "status")
      WHERE "deleted_at" IS NULL;
    `)
    // One OPEN advance per org, settled by the database: requestOrgAdvance's
    // open-advance read and its insert are two statements, so two concurrent
    // requests could both pass the read. This index is the arbiter; the
    // service re-reads a violation and answers open_advance_exists.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_vendor_advance_org_open"
      ON "hawala_vendor_advance" ("partner_org_key")
      WHERE "deleted_at" IS NULL
        AND "recipient_type" = 'PARTNER_ORG'
        AND "status" IN ('PENDING_APPROVAL','APPROVED','ACTIVE');
    `)

    this.addSql(`ALTER TABLE "hawala_advance_repayment" ADD COLUMN IF NOT EXISTS "external_reference" TEXT NULL;`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_advance_repayment_external_reference"
      ON "hawala_advance_repayment" ("advance_id", "external_reference")
      WHERE "deleted_at" IS NULL AND "external_reference" IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    // Only the 1b additions. Part 1's reconciled columns stay (model-owned
    // data); the DROP NOT NULLs and default realignments are not reversed
    // (see the header).
    this.addSql(`DROP INDEX IF EXISTS "UQ_hawala_advance_repayment_external_reference";`)
    this.addSql(`ALTER TABLE "hawala_advance_repayment" DROP COLUMN IF EXISTS "external_reference";`)

    this.addSql(`DROP INDEX IF EXISTS "UQ_hawala_vendor_advance_org_open";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_vendor_advance_org_status";`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" DROP CONSTRAINT IF EXISTS "hawala_vendor_advance_org_disbursement_check";`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" DROP CONSTRAINT IF EXISTS "hawala_vendor_advance_recipient_shape_check";`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" DROP CONSTRAINT IF EXISTS "hawala_vendor_advance_recipient_type_check";`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" DROP COLUMN IF EXISTS "disbursement_reference";`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" DROP COLUMN IF EXISTS "recipient_snapshot";`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" DROP COLUMN IF EXISTS "partner_org_key";`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" DROP COLUMN IF EXISTS "recipient_type";`)
  }
}
