import { model } from "@medusajs/framework/utils"

/**
 * External reconciliation — matching what the outside world says happened
 * (Stripe payouts, bank/ACH statements, Stellar ledger extracts) against
 * what this ledger recorded.
 *
 * This is a different job from `reconciler.ts` / the
 * `hawala-balance-reconciler` job, which check the *internal* invariant
 * (cached account balances vs. the entry log). External reconciliation
 * answers "did the money movement the processor reports correspond to an
 * entry we posted?" — the precondition for turning on Stellar/USDC
 * settlement and ACH payouts with confidence.
 *
 * Design notes (ported from the Blnk Finance reference, simplified for
 * single-operator scale — see docs/REPO_CONSOLIDATION_REVIEW.md §5):
 * - Amounts are **integer cents** end to end. Matching never happens in
 *   floating point.
 * - Ingest is idempotent on (upload_id, external_id) — re-uploading a
 *   statement is a no-op, enforced by a partial unique index in
 *   Migration20260829ExternalReconciliationMonitorsLineage.
 * - A run records is_dry_run, and every match stores which rule matched
 *   it and the signed cents delta, so tolerance drift is auditable.
 * - matched + unmatched always equals the input count for a run.
 */

/**
 * One record from an external money system. `external_id` is the id in
 * the source system (Stripe payout id, Stripe payment-intent id, Stellar
 * transaction hash, bank statement line id); `upload_id` groups the batch
 * it arrived in (an ingest job run or a manual upload).
 */
export const ExternalRecord = model.define("hawala_external_record", {
  id: model.id().primaryKey(),

  upload_id: model.text(),
  external_id: model.text(),

  source: model.enum([
    "STRIPE_PAYOUT",
    "STRIPE_CHARGE",
    "STRIPE_BALANCE_TXN",
    "BANK_STATEMENT",
    "STELLAR_PAYMENT",
    "MANUAL",
  ]),

  /** Signed integer cents as reported by the source system. */
  amount_cents: model.number(),
  currency_code: model.text().default("USD"),

  /** Free-text reference from the source (memo, statement descriptor). */
  reference: model.text().nullable(),
  description: model.text().nullable(),

  /** When the source system says the movement happened. */
  occurred_at: model.dateTime(),

  /** Verbatim source payload for audit. */
  raw: model.json().nullable(),

  status: model
    .enum(["UNMATCHED", "MATCHED", "IGNORED"])
    .default("UNMATCHED"),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["upload_id"], name: "idx_hawala_external_record_upload" },
  { on: ["source", "status"], name: "idx_hawala_external_record_source_status" },
  { on: ["occurred_at"], name: "idx_hawala_external_record_occurred" },
])

/**
 * A named set of matching criteria. `criteria` is a JSON array of the
 * typed union evaluated by external-reconciliation.ts:
 *
 *   { kind: "amount", tolerance_cents?: number, tolerance_bps?: number }
 *   { kind: "reference", mode: "exact" | "normalized" }
 *   { kind: "date", window_seconds: number }
 *   { kind: "currency" }
 *
 * Semantics: AND across the criteria within a rule; OR across rules in a
 * run — the first rule whose every criterion passes claims the match.
 * Unknown kinds fail validation at write time instead of silently
 * failing the rule at match time.
 */
export const MatchingRule = model.define("hawala_matching_rule", {
  id: model.id().primaryKey(),

  name: model.text(),
  description: model.text().nullable(),

  criteria: model.json(),

  is_active: model.boolean().default(true),

  metadata: model.json().nullable(),
})

/**
 * One reconciliation run over one upload batch. Counts are written at
 * finalization; a dry run computes and reports but persists no matches
 * and flips no record statuses.
 */
export const ReconciliationRun = model.define("hawala_reconciliation_run", {
  id: model.id().primaryKey(),

  upload_id: model.text(),

  status: model
    .enum(["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED"])
    .default("PENDING"),

  is_dry_run: model.boolean().default(false),

  /** Rule ids applied, in evaluation order. */
  rule_ids: model.json().nullable(),

  matched_count: model.number().default(0),
  unmatched_count: model.number().default(0),

  started_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),
  error_message: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["upload_id"], name: "idx_hawala_reconciliation_run_upload" },
  { on: ["status"], name: "idx_hawala_reconciliation_run_status" },
])

/**
 * One confirmed pairing of an external record with a ledger entry.
 * `amount_delta_cents` = external minus internal, so tolerance-window
 * matches are auditable. A ledger entry can be claimed at most once per
 * run (partial unique index in the migration).
 */
export const ReconciliationMatch = model.define("hawala_reconciliation_match", {
  id: model.id().primaryKey(),

  run_id: model.text(),
  external_record_id: model.text(),
  ledger_entry_id: model.text(),

  matched_by_rule_id: model.text().nullable(),
  amount_delta_cents: model.number().default(0),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["run_id"], name: "idx_hawala_reconciliation_match_run" },
  { on: ["ledger_entry_id"], name: "idx_hawala_reconciliation_match_entry" },
  { on: ["external_record_id"], name: "idx_hawala_reconciliation_match_external" },
])

/**
 * Paging cursor per ingest source, so pull-based ingestion (Stripe list
 * endpoints, Horizon payments-for-account) resumes where it left off
 * instead of re-reading history. One row per source; uniqueness enforced
 * in the migration.
 */
export const IngestCursor = model.define("hawala_ingest_cursor", {
  id: model.id().primaryKey(),

  source: model.text(),

  /** Opaque cursor in the source's own format (Stripe object id, Horizon paging_token). */
  cursor: model.text().nullable(),

  last_run_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
