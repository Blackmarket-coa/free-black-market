import { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { auditFinancialTransaction } from "../modules/hawala-ledger/audit-logger"
import {
  computePatronageAllocations,
  quarterKey,
  quarterBounds,
} from "../modules/hawala-ledger/patronage-compute"
import type {
  SellerCommissionContribution,
  PatronageAllocationDraft,
} from "../modules/hawala-ledger/patronage-compute"

/**
 * Quarterly patronage refund job.
 *
 * Runs on the first day of each calendar quarter at 02:00 UTC. The job:
 *
 *  1. Computes the boundary of the *previous* quarter.
 *  2. Collects per-seller commission contributions for that period
 *     (sums LedgerEntry rows where reference_type=COMMISSION and the
 *     credit_account_id belongs to the operator commission pool).
 *  3. Looks up the refund pool size from the operator's
 *     `patronage_refund_pool` LedgerAccount; falls back to env var
 *     `PATRONAGE_POOL_USD` for early operation.
 *  4. Computes proportional allocations via `computePatronageAllocations`.
 *  5. Upserts one `PatronageAllocation` row per seller with
 *     `status=computed`.
 *  6. (Settlement of the rows is left to a follow-up workflow that
 *     constructs the atomic Stellar tx and updates rows to `paid`. This
 *     job stops at `computed` so an operator can review before
 *     disbursement.)
 *
 * Why split compute and settle: USD payout under Posture A goes via
 * Stripe ACH (not Stellar). The atomic-Stellar-tx ideal applies when
 * Posture C activates and USDC payouts unlock; in v1 we compute the
 * allocation table and let the existing settlement pipeline disburse
 * via Stripe.
 *
 * See `docs/POSTURE_A_COMPLIANCE.md`, `docs/COMPOSITION_LAYER.md`.
 */
export default async function patronageRefundJob(container: MedusaContainer) {
  const hawalaService =
    container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const logger = (container.resolve("logger") as {
    info: (m: string) => void
    error: (m: string, e?: unknown) => void
  }) || console

  // Compute the previous quarter relative to "now".
  const now = new Date()
  const lookback = new Date(now.getTime() - 24 * 3600 * 1000) // 1 day prior, so the run on Q+1 day 1 still targets Q
  const prev = new Date(lookback.getTime() - 31 * 24 * 3600 * 1000) // step back ~a month into the previous quarter
  const period = quarterBounds(prev)
  const period_key = quarterKey(prev)

  logger.info(
    `[patronage-refund] computing allocations for ${period_key} (${period.start.toISOString()} → ${period.end.toISOString()})`
  )

  // Collect commission contributions per seller.
  const contributions: SellerCommissionContribution[] = []
  try {
    const entries = await (hawalaService as any).listLedgerEntries({
      reference_type: "COMMISSION",
    })
    const inPeriod = entries.filter((e: any) => {
      const created = new Date(e.created_at)
      return created >= period.start && created < period.end
    })

    const bySeller = new Map<string, number>()
    for (const e of inPeriod) {
      // Convention: COMMISSION entries record the seller id in metadata.
      const sellerId =
        (e.metadata && e.metadata.seller_id) ||
        (e.metadata && e.metadata.vendor_id) ||
        null
      if (!sellerId) continue
      bySeller.set(sellerId, (bySeller.get(sellerId) ?? 0) + Number(e.amount))
    }
    for (const [seller_id, commission_paid] of bySeller.entries()) {
      contributions.push({ seller_id, commission_paid })
    }
  } catch (err) {
    logger.error("[patronage-refund] failed to read commission entries", err)
    return
  }

  if (contributions.length === 0) {
    logger.info("[patronage-refund] no commission contributions in period — nothing to allocate")
    return
  }

  // Resolve pool size. Prefer the operator's pool ledger account; fall
  // back to env var for early operation.
  let pool_amount = 0
  let pool_currency = "USD"
  try {
    const [pool] = await (hawalaService as any).listLedgerAccounts({
      account_type: "PATRONAGE_POOL",
    })
    if (pool) {
      pool_amount = Number(pool.available_balance)
      pool_currency = pool.currency_code || "USD"
    }
  } catch {
    // ignore — fallback below
  }
  if (pool_amount <= 0 && process.env.PATRONAGE_POOL_USD) {
    pool_amount = Number(process.env.PATRONAGE_POOL_USD)
  }

  if (pool_amount <= 0) {
    logger.info(
      "[patronage-refund] pool amount is zero — skipping. Configure a PATRONAGE_POOL ledger account or PATRONAGE_POOL_USD env var to enable."
    )
    return
  }

  const drafts: PatronageAllocationDraft[] = computePatronageAllocations({
    period_start: period.start,
    period_end: period.end,
    period_key,
    pool_amount,
    pool_currency,
    contributions,
  })

  let upserted = 0
  let failed = 0
  for (const draft of drafts) {
    try {
      const existing = await (hawalaService as any).listPatronageAllocations({
        seller_id: draft.seller_id,
        period_key,
      })
      const computed_at = new Date()
      if (existing?.[0]) {
        await (hawalaService as any).updatePatronageAllocations({
          id: existing[0].id,
          ...draft,
          status: "computed",
          computed_at,
        })
      } else {
        await (hawalaService as any).createPatronageAllocations({
          ...draft,
          status: "computed",
          computed_at,
        })
      }
      upserted++

      auditFinancialTransaction(
        "PAYOUT_REQUESTED",
        draft.seller_id,
        "VENDOR",
        `patronage-${period_key}`,
        draft.allocation_amount,
        {
          period_key,
          gross_volume: draft.gross_volume,
          status: "computed",
        }
      )
    } catch (err) {
      failed++
      logger.error(
        `[patronage-refund] failed to upsert allocation for seller ${draft.seller_id}`,
        err
      )
    }
  }

  logger.info(
    `[patronage-refund] ${period_key}: ${upserted} allocations computed (${failed} failed)`
  )
}

export const config = {
  name: "patronage-quarterly-refund",
  // First day of each quarter at 02:00 UTC (production, redis-backed workflow
  // engine). When REDIS_URL is unset (integration tests / redis-less dev) Medusa
  // uses the in-memory workflow engine, which schedules the next run with a raw
  // `setTimeout(delayMs)`. A quarterly interval (~90 days) exceeds Node's 32-bit
  // timer limit (~24.8 days), so the delay overflows, gets clamped to 1ms, fires
  // immediately, reschedules a quarter further out, overflows again — an infinite
  // 1ms busy-loop that leaks timers and OOMs the process. Fall back to a daily
  // cron there: it never fits-to-overflow, is idempotent, and never actually
  // fires during a short test run. Production (redis engine) is unaffected.
  schedule: process.env.REDIS_URL ? "0 2 1 1,4,7,10 *" : "0 2 * * *",
}
