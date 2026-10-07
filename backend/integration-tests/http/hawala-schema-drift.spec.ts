import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import * as models from "../../src/modules/hawala-ledger/models"

jest.setTimeout(240 * 1000)

/**
 * Model / migration drift in the hawala ledger (SD-42), on a database built
 * from the migrations exactly as production's is.
 *
 * A model column that no migration created is invisible to every check FBM
 * runs: `medusa build` and `tsc` type the model, the unit specs shadow the
 * writes, and the module test runners build their schema FROM the models.
 * It surfaces only when a real insert runs on a migrated database — which is
 * how SD-39's breakdown columns, `hawala_ledger_entry`
 * (Migration20260904AddLedgerEntryModelColumns), the pool tables
 * (Migration20261004PoolCarrier) and the payout-request / vendor-payment
 * tables (Migration20261007PayoutRequestVendorPaymentDrift) were each found,
 * one at a time.
 *
 * This walks every hawala model and lists the columns (and `raw_*`
 * companions of `bigNumber` fields) its table lacks. KNOWN_DRIFT is the debt
 * recorded in SD-42, exactly: a table that drifts further, a new model with
 * a missing column, or a fix that is not reflected here all fail. A ratchet,
 * like the `no-explicit-any` overrides — shrink it when a table is fixed;
 * never grow it to make a new model pass.
 */
const KNOWN_DRIFT: Record<string, string[]> = {
  hawala_settlement_batch: [
    "period_start", "period_end", "total_entries", "total_volume", "raw_total_volume", "net_settlement_amount",
    "raw_net_settlement_amount", "merkle_root", "stellar_ledger_sequence", "stellar_fee_paid", "raw_stellar_fee_paid",
    "error_message", "retry_count", "submitted_at", "confirmed_at",
  ],
  hawala_ach_transaction: [
    "ledger_account_id", "transaction_type", "currency_code", "stripe_fee", "raw_stripe_fee", "net_amount",
    "raw_net_amount", "stripe_payment_intent_id", "stripe_charge_id", "ach_return_code", "failed_at",
    "expected_settlement_date", "actual_settlement_date", "idempotency_key",
  ],
  hawala_bank_account: [
    "ledger_account_id", "stripe_customer_id", "stripe_payment_method_id", "bank_name", "last_four",
    "routing_number_last_four", "verification_status", "verification_method", "status", "verified_at",
  ],
  hawala_chargeback_claim: [
    "vendor_id", "chargeback_amount", "raw_chargeback_amount", "vendor_liability", "raw_vendor_liability",
    "stripe_dispute_id", "dispute_reason", "resolution_notes",
  ],
  hawala_chargeback_protection: [
    "pool_balance", "raw_pool_balance", "total_contributions", "raw_total_contributions", "total_claims_paid",
    "raw_total_claims_paid", "contribution_rate", "raw_contribution_rate", "max_coverage_per_claim",
    "raw_max_coverage_per_claim", "max_total_coverage", "raw_max_total_coverage", "is_eligible", "eligibility_date",
    "months_active", "chargeback_rate", "raw_chargeback_rate",
  ],
  hawala_payout_config: [
    "ledger_account_id", "default_bank_account_id", "default_payout_tier", "auto_payout_enabled",
    "auto_payout_threshold", "raw_auto_payout_threshold", "auto_payout_day", "instant_payout_eligible",
    "instant_payout_daily_limit", "raw_instant_payout_daily_limit", "instant_payout_used_today",
    "raw_instant_payout_used_today", "split_payout_enabled", "status",
  ],
  hawala_payout_split_rule: [
    "payout_config_id", "destination_ledger_account_id", "destination_bank_account_id", "raw_percentage", "label",
  ],
  hawala_credit_line_transaction: [
    "vendor_payment_id", "transaction_type", "balance_after", "raw_balance_after", "due_date", "status", "notes",
  ],
  hawala_vendor_credit_line: [
    "creditor_vendor_id", "creditor_ledger_account_id", "debtor_vendor_id", "debtor_ledger_account_id", "terms_days",
    "raw_interest_rate", "late_fee_rate", "raw_late_fee_rate", "grace_period_days", "last_activity_at",
    "total_credit_used", "raw_total_credit_used", "total_repaid", "raw_total_repaid",
  ],
}

type ParsedProperty = { type?: string; dataType?: { name?: string } }
type DmlModel = {
  schema: Record<string, { parse?: (name: string) => ParsedProperty }>
  parse: () => { tableName: string }
}

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    it("every hawala model's columns exist on the migrated database, except the drift SD-42 records", async () => {
      const pg = (getContainer() as { resolve: (k: string) => { raw: (q: string, b?: unknown[]) => Promise<{ rows: Array<{ column_name: string }> }> } }).resolve(
        ContainerRegistrationKeys.PG_CONNECTION
      )
      const drift: Record<string, string[]> = {}
      for (const m of Object.values(models as Record<string, unknown>)) {
        const model = m as DmlModel
        if (!model || typeof model !== "object" || !model.schema || typeof model.parse !== "function") continue
        const table = model.parse().tableName
        const cols = new Set(
          (await pg.raw(`SELECT column_name FROM information_schema.columns WHERE table_name = ?`, [table])).rows.map(
            (r) => r.column_name
          )
        )
        const missing: string[] = []
        if (cols.size === 0) missing.push("<table>")
        for (const [prop, def] of Object.entries(model.schema)) {
          const parsed = def?.parse?.(prop)
          if (!parsed) continue
          if (["hasOne", "hasMany", "manyToMany"].includes(String(parsed.type))) continue
          if (parsed.type === "belongsTo") {
            if (!cols.has(`${prop}_id`)) missing.push(`${prop}_id`)
            continue
          }
          if (!cols.has(prop)) missing.push(prop)
          if (parsed.dataType?.name === "bigNumber" && !cols.has(`raw_${prop}`)) missing.push(`raw_${prop}`)
        }
        for (const c of ["created_at", "updated_at", "deleted_at"]) if (!cols.has(c)) missing.push(c)
        if (missing.length > 0) drift[table] = [...new Set(missing)]
      }
      const sorted = (r: Record<string, string[]>) =>
        Object.fromEntries(Object.keys(r).sort().map((k) => [k, [...r[k]].sort()]))
      expect(sorted(drift)).toEqual(sorted(KNOWN_DRIFT))
    })
  },
})
