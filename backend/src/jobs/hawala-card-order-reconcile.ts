import { createLogger } from "../shared/logger"
const log = createLogger("jobs/hawala-card-order-reconcile")
import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { featureFlagState } from "../shared/feature-flags"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import { CARD_CLEARING_ACCOUNT_TYPE, CARD_CLEARING_OWNER_ID } from "../modules/hawala-ledger/card-clearing"
import { reconcileCardOrder, type CardOrderReconcileOutcome } from "../lib/card-order-reconcile"

/**
 * Orders placed this recently are checked for a capture that was missed.
 * Also how far back the FIRST run after the flag is set settles card orders
 * that were captured while it was off.
 */
export const CARD_SETTLE_WINDOW_DAYS = 7
/**
 * Settled card orders this recent are checked for refunds. Card refunds can
 * be issued long after capture; 180 days is a chosen horizon, not a Stripe
 * limit — older refunds need a person (SD-36 open items).
 */
export const CARD_REFUND_WINDOW_DAYS = 180
const PAGE = 200
/** Per pass, per run; anything beyond is logged with its count, never silently skipped. */
const MAX_PER_PASS = 5000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Bring card orders' ledgers into step with their money (SD-36,
 * `FF_CARD_ORDER_LEDGER_V1`; `lib/card-order-reconcile.ts`). Two passes:
 *
 *   1. Settle: every order placed in the last CARD_SETTLE_WINDOW_DAYS — a
 *      capture whose event was lost, or that raced Mercur's follow-up.
 *   2. Refunds: every order settled from card clearing in the last
 *      CARD_REFUND_WINDOW_DAYS and not fully refunded, found from the
 *      ledger's own purchase legs (cheap) — a Mercur split refund emits no
 *      event, so this is the only path that sees it.
 *
 * Oldest first, so a backlog is worked through rather than starving the
 * oldest. Every action is keyed and per-order locked, so it runs safely
 * alongside the subscribers. Flag off: returns before any read.
 */
export default async function hawalaCardOrderReconcileJob(container: MedusaContainer): Promise<void> {
  if (!featureFlagState.isEnabled("CARD_ORDER_LEDGER_V1")) return

  const counts: Partial<Record<CardOrderReconcileOutcome, number>> = {}
  const done = new Set<string>()
  const visit = async (orderId: string) => {
    if (done.has(orderId)) return
    done.add(orderId)
    const { outcome } = await reconcileCardOrder(container, orderId)
    counts[outcome] = (counts[outcome] ?? 0) + 1
  }

  try {
    // Pass 1 — recent orders, for settlement.
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const settleSince = new Date(Date.now() - CARD_SETTLE_WINDOW_DAYS * DAY_MS)
    let seen = 0
    for (let skip = 0; ; skip += PAGE) {
      const { data } = await query.graph({
        entity: "order",
        fields: ["id"],
        filters: { created_at: { $gte: settleSince } },
        pagination: { skip, take: PAGE, order: { created_at: "ASC" } },
      })
      const ids = (data as Array<{ id: string }>).map((o) => o.id)
      for (const id of ids) await visit(id)
      seen += ids.length
      if (ids.length < PAGE) break
      if (seen >= MAX_PER_PASS) {
        log.warn(`[hawala-card-order-reconcile] settle pass stopped at ${seen} orders; the newest were not checked this run`)
        break
      }
    }

    // Pass 2 — settled card orders, for refunds.
    const hawala: any = container.resolve(HAWALA_LEDGER_MODULE)
    const [clearing] = await hawala.listLedgerAccounts({
      account_type: CARD_CLEARING_ACCOUNT_TYPE,
      owner_type: "SYSTEM",
      owner_id: CARD_CLEARING_OWNER_ID,
    })
    if (clearing) {
      const refundSince = new Date(Date.now() - CARD_REFUND_WINDOW_DAYS * DAY_MS)
      const purchases = (await hawala.listLedgerEntries(
        { debit_account_id: clearing.id, entry_type: "PURCHASE", status: "COMPLETED", created_at: { $gte: refundSince } },
        { order: { created_at: "ASC" } }
      )) as Array<{ order_id?: string | null }>
      const orderIds = [...new Set(purchases.map((p) => p.order_id).filter((x): x is string => !!x))]
      if (orderIds.length > MAX_PER_PASS) {
        log.warn(
          `[hawala-card-order-reconcile] refund pass: ${orderIds.length} settled card orders; checking the oldest ${MAX_PER_PASS} this run`
        )
      }
      for (const id of orderIds.slice(0, MAX_PER_PASS)) await visit(id)
    }
  } catch (error) {
    log.error("[hawala-card-order-reconcile] Sweep failed:", error)
    return
  }

  const attention = (counts.needs_attention ?? 0) + (counts.unattributed_refund ?? 0) + (counts.refund_refused ?? 0)
  const line = `[hawala-card-order-reconcile] ${done.size} orders: ${JSON.stringify(counts)}`
  if (attention > 0) log.warn(`${line} — ${attention} need a person (see the errors above)`)
  else log.info(line)
}

export const config = {
  name: "hawala-card-order-reconcile",
  schedule: "*/15 * * * *",
}
