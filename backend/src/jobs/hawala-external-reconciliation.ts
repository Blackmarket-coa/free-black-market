import { createLogger } from "../shared/logger"
const log = createLogger("jobs/hawala-external-reconciliation")
import { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import { createStripeAchService } from "../modules/hawala-ledger/stripe-ach"
import { createStellarSettlementService } from "../modules/hawala-ledger/stellar-settlement"

/**
 * Nightly external reconciliation: pull external money records (Stripe
 * payouts + balance transactions, Stellar payments) from where each
 * source last left off, then match the day's batch against ledger
 * entries with the active matching rules.
 *
 * Distinct from `hawala-balance-reconciler` (which checks the INTERNAL
 * cached-balance-vs-entries invariant): this job checks the ledger
 * against what the OUTSIDE world says happened. Pull cursors persist in
 * `hawala_ingest_cursor`, so re-runs never re-read history; ingest is
 * additionally idempotent per (upload_id, external_id).
 *
 * Sources degrade independently: an unconfigured or failing source is
 * logged and skipped, never fatal to the others. With no active matching
 * rules the job ingests but skips the matching run (rules are an
 * operator decision — see /admin/hawala/reconciliation/rules).
 */
export default async function hawalaExternalReconciliationJob(
  container: MedusaContainer
): Promise<void> {
  const hawala: any = container.resolve(HAWALA_LEDGER_MODULE)
  const uploadId = `pull-${new Date().toISOString().slice(0, 10)}`

  async function getCursor(source: string): Promise<string | undefined> {
    const rows = await hawala.listIngestCursors({ source })
    return rows[0]?.cursor ?? undefined
  }

  async function setCursor(source: string, cursor: string | null): Promise<void> {
    const rows = await hawala.listIngestCursors({ source })
    if (rows[0]) {
      await hawala.updateIngestCursors({
        id: rows[0].id,
        ...(cursor ? { cursor } : {}),
        last_run_at: new Date(),
      })
    } else {
      await hawala.createIngestCursors({ source, cursor, last_run_at: new Date() })
    }
  }

  let totalIngested = 0

  // --- Stripe (payouts + balance transactions) ---
  if (process.env.STRIPE_SECRET_KEY) {
    const stripe = createStripeAchService()
    for (const [source, list] of [
      [
        "STRIPE_PAYOUT",
        (cursor?: string) => stripe.listPayoutsForReconciliation({ startingAfter: cursor }),
      ],
      [
        "STRIPE_BALANCE_TXN",
        (cursor?: string) =>
          stripe.listBalanceTransactionsForReconciliation({ startingAfter: cursor }),
      ],
    ] as const) {
      try {
        let cursor = await getCursor(source)
        // Bounded pages per run: a nightly job never needs to drain years
        // of history in one pass, and the cursor resumes tomorrow.
        for (let page = 0; page < 10; page++) {
          const result = await list(cursor)
          if (result.records.length > 0) {
            const ingest = await hawala.ingestExternalRecords(result.records, uploadId)
            totalIngested += ingest.ingested
          }
          if (!result.next_cursor) break
          cursor = result.next_cursor
          await setCursor(source, cursor)
          if (!result.has_more) break
        }
        await setCursor(source, cursor ?? null)
      } catch (error) {
        log.warn(`[hawala-external-reconciliation] ${source} ingest failed:`, error)
      }
    }
  } else {
    log.info("[hawala-external-reconciliation] Stripe not configured; skipping")
  }

  // --- Stellar payments ---
  if (process.env.STELLAR_SIGNER_SECRET) {
    try {
      const stellar = createStellarSettlementService()
      let cursor = await getCursor("STELLAR_PAYMENT")
      for (let page = 0; page < 10; page++) {
        const result = await stellar.listAccountPayments({ cursor })
        if (result.records.length > 0) {
          const ingest = await hawala.ingestExternalRecords(result.records, uploadId)
          totalIngested += ingest.ingested
        }
        if (!result.next_cursor || result.next_cursor === cursor) break
        cursor = result.next_cursor
        await setCursor("STELLAR_PAYMENT", cursor)
        if (result.records.length === 0) break
      }
    } catch (error) {
      log.warn("[hawala-external-reconciliation] Stellar ingest failed:", error)
    }
  } else {
    log.info("[hawala-external-reconciliation] Stellar not configured; skipping")
  }

  // --- Match the batch ---
  const unmatched = await hawala.listExternalRecords(
    { upload_id: uploadId, status: "UNMATCHED" },
    { take: 1 }
  )
  if (unmatched.length === 0) {
    log.info(
      `[hawala-external-reconciliation] ingested=${totalIngested}, nothing unmatched to reconcile`
    )
    return
  }

  const rules = await hawala.listMatchingRules({ is_active: true })
  if (rules.length === 0) {
    log.warn(
      `[hawala-external-reconciliation] ingested=${totalIngested} record(s) but no active matching rules exist — ` +
        `create one via POST /admin/hawala/reconciliation/rules to enable matching`
    )
    return
  }

  try {
    const outcome = await hawala.runExternalReconciliation({ upload_id: uploadId })
    log.info(
      `[hawala-external-reconciliation] run=${outcome.run_id} matched=${outcome.matched_count} unmatched=${outcome.unmatched_count}`
    )
    if (outcome.unmatched_count > 0) {
      log.warn(
        `[hawala-external-reconciliation] ${outcome.unmatched_count} external record(s) have no ledger counterpart — ` +
          `review GET /admin/hawala/reconciliation/runs/${outcome.run_id}/unmatched`
      )
    }
  } catch (error) {
    log.error("[hawala-external-reconciliation] Matching run failed:", error)
  }
}

export const config = {
  name: "hawala-external-reconciliation",
  // Nightly at 01:30 — after Stripe's daily payout cycle settles.
  schedule: "30 1 * * *",
}
