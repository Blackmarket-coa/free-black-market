import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import { reconcileLedgerBalances } from "../modules/hawala-ledger/reconciler"

/**
 * Scheduled balance-integrity sweep for the hawala ledger.
 *
 * Recomputes each account's balance from the immutable `ledger_entry`
 * log and compares it to the cached `ledger_account.balance`. Drifts are
 * logged/warned but NEVER auto-corrected — a drift is an operator signal,
 * not something a cron job should silently "fix".
 *
 * The per-account logic lives in
 * `backend/src/modules/hawala-ledger/reconciler.ts` so it's unit-testable
 * with fake services; this job is the thin scheduled wrapper.
 */
export default async function hawalaBalanceReconcilerJob(
  container: MedusaContainer
): Promise<void> {
  const hawala: any = container.resolve(HAWALA_LEDGER_MODULE)
  const pgConnection: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  console.log("[hawala-balance-reconciler] Starting balance drift sweep")

  let drifts
  try {
    drifts = await reconcileLedgerBalances(hawala, pgConnection)
  } catch (error) {
    console.error("[hawala-balance-reconciler] Sweep failed:", error)
    return
  }

  if (drifts.length === 0) {
    console.log("[hawala-balance-reconciler] No balance drift detected")
    return
  }

  console.warn(
    `[hawala-balance-reconciler] Detected ${drifts.length} account(s) with balance drift; ` +
      `manual investigation required (NOT auto-corrected)`
  )
  for (const d of drifts) {
    console.warn(
      `[hawala-balance-reconciler]   account=${d.account_id} ` +
        `cached=${d.cached} computed=${d.computed} drift=${d.drift}`
    )
  }
}

export const config = {
  name: "hawala-balance-reconciler",
  // Every 6 hours. Reconciliation is a safety net, not real-time.
  schedule: "0 */6 * * *",
}
