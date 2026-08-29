import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration: external reconciliation, balance monitors, and entry lineage.
 *
 * Part of the Blnk-harvest workstream (docs/REPO_CONSOLIDATION_REVIEW.md §5):
 *
 * - `hawala_external_record` / `hawala_matching_rule` /
 *   `hawala_reconciliation_run` / `hawala_reconciliation_match` /
 *   `hawala_ingest_cursor` — matching external money records (Stripe
 *   payouts/charges, bank statements, Stellar payments) against ledger
 *   entries. Ingest is idempotent on (upload_id, external_id); a ledger
 *   entry can be claimed at most once per run.
 *
 * - `hawala_balance_monitor` / `hawala_monitor_breach` — edge-triggered
 *   threshold alerts on ledger accounts (thresholds in integer cents).
 *
 * - `correlation_id` / `parent_entry_id` on `hawala_ledger_entry` —
 *   explicit lineage handles. Backfilled from the historical
 *   idempotency-key suffix convention used by the fan-out sites
 *   (processOrderPayment: -purchase/-fee/-seller/-invest;
 *   processConsignmentSplit: -consignor/-vendor).
 *
 * - Match-key indexes that external reconciliation joins on:
 *   `hawala_settlement_batch.stellar_tx_hash` and
 *   `hawala_ach_transaction.stripe_payout_id` (the column has existed
 *   since Migration20251229CreateHawalaLedger; it was only missing from
 *   the DML model).
 */
export class Migration20260829ExternalReconciliationMonitorsLineage extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_external_record" (
        "id" TEXT NOT NULL,
        "upload_id" TEXT NOT NULL,
        "external_id" TEXT NOT NULL,
        "source" TEXT NOT NULL,
        "amount_cents" INTEGER NOT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'USD',
        "reference" TEXT NULL,
        "description" TEXT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "raw" JSONB NULL,
        "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_external_record_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_external_record_source_chk" CHECK (
          "source" IN ('STRIPE_PAYOUT', 'STRIPE_CHARGE', 'STRIPE_BALANCE_TXN', 'BANK_STATEMENT', 'STELLAR_PAYMENT', 'MANUAL')
        ),
        CONSTRAINT "hawala_external_record_status_chk" CHECK (
          "status" IN ('UNMATCHED', 'MATCHED', 'IGNORED')
        )
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_external_record_upload_external" ON "hawala_external_record" ("upload_id", "external_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_external_record_upload" ON "hawala_external_record" ("upload_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_external_record_source_status" ON "hawala_external_record" ("source", "status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_external_record_occurred" ON "hawala_external_record" ("occurred_at") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_matching_rule" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NULL,
        "criteria" JSONB NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_matching_rule_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_reconciliation_run" (
        "id" TEXT NOT NULL,
        "upload_id" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "is_dry_run" BOOLEAN NOT NULL DEFAULT FALSE,
        "rule_ids" JSONB NULL,
        "matched_count" INTEGER NOT NULL DEFAULT 0,
        "unmatched_count" INTEGER NOT NULL DEFAULT 0,
        "started_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "error_message" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_reconciliation_run_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_reconciliation_run_status_chk" CHECK (
          "status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')
        )
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_reconciliation_run_upload" ON "hawala_reconciliation_run" ("upload_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_reconciliation_run_status" ON "hawala_reconciliation_run" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_reconciliation_match" (
        "id" TEXT NOT NULL,
        "run_id" TEXT NOT NULL,
        "external_record_id" TEXT NOT NULL,
        "ledger_entry_id" TEXT NOT NULL,
        "matched_by_rule_id" TEXT NULL,
        "amount_delta_cents" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_reconciliation_match_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_reconciliation_match_run_entry" ON "hawala_reconciliation_match" ("run_id", "ledger_entry_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_reconciliation_match_run_external" ON "hawala_reconciliation_match" ("run_id", "external_record_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_reconciliation_match_run" ON "hawala_reconciliation_match" ("run_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_reconciliation_match_entry" ON "hawala_reconciliation_match" ("ledger_entry_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_reconciliation_match_external" ON "hawala_reconciliation_match" ("external_record_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_ingest_cursor" (
        "id" TEXT NOT NULL,
        "source" TEXT NOT NULL,
        "cursor" TEXT NULL,
        "last_run_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_ingest_cursor_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hawala_ingest_cursor_source" ON "hawala_ingest_cursor" ("source") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_balance_monitor" (
        "id" TEXT NOT NULL,
        "account_id" TEXT NOT NULL,
        "field" TEXT NOT NULL DEFAULT 'balance',
        "operator" TEXT NOT NULL,
        "threshold_cents" INTEGER NOT NULL,
        "severity" TEXT NOT NULL DEFAULT 'high',
        "description" TEXT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "was_breached" BOOLEAN NOT NULL DEFAULT FALSE,
        "last_evaluated_at" TIMESTAMPTZ NULL,
        "last_breached_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_balance_monitor_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_balance_monitor_field_chk" CHECK (
          "field" IN ('balance', 'available_balance', 'pending_balance')
        ),
        CONSTRAINT "hawala_balance_monitor_operator_chk" CHECK (
          "operator" IN ('>', '<', '>=', '<=', '==', '!=')
        ),
        CONSTRAINT "hawala_balance_monitor_severity_chk" CHECK (
          "severity" IN ('low', 'medium', 'high', 'critical')
        )
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_balance_monitor_account" ON "hawala_balance_monitor" ("account_id", "is_active") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_monitor_breach" (
        "id" TEXT NOT NULL,
        "monitor_id" TEXT NOT NULL,
        "account_id" TEXT NOT NULL,
        "observed_cents" INTEGER NOT NULL,
        "threshold_cents" INTEGER NOT NULL,
        "operator" TEXT NOT NULL,
        "field" TEXT NOT NULL,
        "incident_key" TEXT NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_monitor_breach_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_hawala_monitor_breach_monitor" ON "hawala_monitor_breach" ("monitor_id", "occurred_at" DESC) WHERE "deleted_at" IS NULL;`)

    // Lineage columns on the entry table. Plain TEXT, no raw_* twin needed.
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT NULL;`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "parent_entry_id" TEXT NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ledger_entry_correlation" ON "hawala_ledger_entry" ("correlation_id") WHERE "deleted_at" IS NULL;`)

    // Backfill correlation_id from the historical idempotency-key suffix
    // convention. Only rows whose key carries a known fan-out suffix get a
    // correlation_id; standalone keys stay NULL (they correlate with nothing).
    this.addSql(`
      UPDATE "hawala_ledger_entry"
      SET "correlation_id" = regexp_replace("idempotency_key", '-(purchase|fee|seller|invest|consignor|vendor|net)$', '')
      WHERE "correlation_id" IS NULL
        AND "idempotency_key" ~ '-(purchase|fee|seller|invest|consignor|vendor|net)$';
    `)

    // Match-key indexes for external reconciliation joins.
    //
    // The SettlementBatch MODEL uses `stellar_tx_hash`, but the original
    // DDL (Migration20251229CreateHawalaLedger) created the column as
    // `stellar_transaction_hash`, so migration-built databases (fresh
    // installs, integration-test DBs) don't have the model's column at
    // all. Add it before indexing it; the legacy `stellar_transaction_hash`
    // column is left untouched where it exists.
    this.addSql(`ALTER TABLE "hawala_settlement_batch" ADD COLUMN IF NOT EXISTS "stellar_tx_hash" TEXT NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_settlement_batch_stellar_tx" ON "hawala_settlement_batch" ("stellar_tx_hash") WHERE "stellar_tx_hash" IS NOT NULL AND "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ach_transaction_stripe_payout" ON "hawala_ach_transaction" ("stripe_payout_id") WHERE "stripe_payout_id" IS NOT NULL AND "deleted_at" IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_ach_transaction_stripe_payout";`)
    this.addSql(`DROP INDEX IF EXISTS "idx_settlement_batch_stellar_tx";`)
    this.addSql(`DROP INDEX IF EXISTS "idx_ledger_entry_correlation";`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" DROP COLUMN IF EXISTS "parent_entry_id";`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" DROP COLUMN IF EXISTS "correlation_id";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_monitor_breach";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_balance_monitor";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_ingest_cursor";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_reconciliation_match";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_reconciliation_run";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_matching_rule";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_external_record";`)
  }
}
