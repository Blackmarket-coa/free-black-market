import { createLogger } from "../shared/logger"
const log = createLogger("lib/card-order-reconcile")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { CARD_FUNDING } from "../modules/hawala-ledger/card-clearing"
import {
  isFullyCaptured,
  readCardSettlementOrder,
  sellersForPaymentCollection,
  toCents,
  type CardSettlementOrder,
} from "./card-order-settlement"
import { settleOrderPayment } from "../subscribers/hawala-order-payment"

type Container = { resolve: (key: string) => any }

export type CardOrderReconcileOutcome =
  | "not_card"
  | "not_captured"
  | "unreadable"
  | "settled"
  | "completed_partial_settlement"
  | "in_step"
  | "refund_posted"
  | "refund_refused"
  | "unattributed_refund"
  | "needs_attention"

export type CardOrderReconcileResult = { outcome: CardOrderReconcileOutcome; refunded_cents?: number }

const SELLER_SIDE_KEY = /^order-payment-.+-(seller|consignor|vendor)$/

/**
 * Serialize everything that moves ONE card order's money: a transaction-
 * scoped advisory lock (released at commit or rollback), held while the
 * order is read and its legs posted. Without it, two callers that read
 * different refunded totals (a refund event and the job, a second refund
 * seconds after the first) both see nothing posted and both post, and a
 * refund can interleave with a settlement half-way through its legs. The
 * legs themselves commit on their own connections, exactly as the BM-7
 * seller-account lock does, so a rollback here never undoes a balance move
 * behind a COMPLETED entry. `lock_timeout` bounds the wait; a timeout is an
 * error the caller logs, and the reconciler job retries it. Without a pg
 * connection (unit tests without one) it runs unserialized.
 */
async function withCardOrderLock<T>(container: Container, orderId: string, fn: () => Promise<T>): Promise<T> {
  let pg: { transaction?: (work: (trx: { raw: (sql: string, b?: unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T> } | undefined
  try {
    pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  } catch {
    pg = undefined
  }
  if (!pg || typeof pg.transaction !== "function") return fn()
  return pg.transaction(async (trx) => {
    await trx.raw("SET LOCAL lock_timeout = '10s'")
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))", ["hawala-card-order", orderId])
    return fn()
  })
}

/**
 * The ONE way a card order's ledger moves (SD-36, `FF_CARD_ORDER_LEDGER_V1`;
 * callers check the flag): placement, `payment.captured`, `payment.refunded`,
 * `order.canceled` and the reconciler job all come through here, under the
 * per-order lock, and everything is re-read inside it.
 *
 *   1. Not settled and its own money fully captured -> settle.
 *   2. Purchase leg COMPLETED but no seller-side leg (a settlement that died
 *      between legs) -> finish it; every leg is keyed, so only what is
 *      missing posts. A purchase leg that is not COMPLETED is never built
 *      on: logged for a person (`needs_attention`).
 *   3. Refunded (by this order's own record) more than the ledger posted ->
 *      post the difference through `processRefund`, back to card clearing,
 *      keyed by the cumulative refunded total. `processRefund` refuses before
 *      any leg if the seller cannot cover it, so a refusal leaves nothing
 *      half-posted and the next run retries the whole delta.
 *   4. A refund on the order's payment collection that no order's own
 *      record accounts for (a Medusa-native refund or admin cancel on a
 *      Mercur cart) -> logged as an error, `unattributed_refund`; the money
 *      is not guessed onto a seller, and every seller on that collection is
 *      held (SD-40, `models/payout-hold.ts`) until an admin assigns it
 *      (`POST /admin/hawala/card-refunds/:id/attribute`). Once every refund
 *      on the collection is accounted for, its holds are released.
 *
 * Never throws.
 */
export async function reconcileCardOrder(container: Container, orderId: string): Promise<CardOrderReconcileResult> {
  try {
    return await withCardOrderLock(container, orderId, () => reconcileLocked(container, orderId))
  } catch (error) {
    log.error(`[Hawala] Could not reconcile card order ${orderId}:`, error)
    return { outcome: "unreadable" }
  }
}

async function reconcileLocked(container: Container, orderId: string): Promise<CardOrderReconcileResult> {
  const order = await readCardSettlementOrder(container, orderId)
  if (!order) return { outcome: "unreadable" }
  if (order.funding !== "fbm_card") return { outcome: "not_card" }

  const hawala = container.resolve(HAWALA_LEDGER_MODULE) as HawalaLedgerModuleService
  const purchaseKey = `order-payment-${orderId}-purchase`
  let [purchase] = await hawala.listLedgerEntries({ idempotency_key: purchaseKey })

  let settledNow = false
  if (!purchase) {
    if (!isFullyCaptured(order)) {
      if (order.captured !== null && order.captured > 0) {
        log.warn(
          `[Hawala] Card order ${orderId}: ${order.captured} captured of ${order.total}; not settled until fully captured`
        )
      }
      return { outcome: "not_captured" }
    }
    await settleOrderPayment(container as never, orderId, { funding: "card_clearing", order })
    settledNow = true
    ;[purchase] = await hawala.listLedgerEntries({ idempotency_key: purchaseKey })
    if (!purchase) return { outcome: "needs_attention" }
  }

  if ((purchase.metadata as { funding?: unknown } | null)?.funding !== CARD_FUNDING) {
    // Settled some other way (a wallet, before the flag): its refunds keep
    // the old path.
    return { outcome: "not_card" }
  }
  if (purchase.status === "REVERSED") return { outcome: "in_step" }
  if (purchase.status !== "COMPLETED") {
    log.error(
      `[Hawala] Card order ${orderId}: purchase leg is ${purchase.status}; nothing is built on it — needs a person`
    )
    return { outcome: "needs_attention" }
  }

  let completed = false
  const transfers = await hawala.listLedgerEntries({ order_id: orderId, entry_type: "TRANSFER" })
  const sellerSideDone = transfers.some(
    (e: { idempotency_key?: string | null; status?: string }) =>
      e.status === "COMPLETED" && typeof e.idempotency_key === "string" && SELLER_SIDE_KEY.test(e.idempotency_key)
  )
  if (!sellerSideDone) {
    log.error(`[Hawala] Card order ${orderId} settled only in part; completing the missing legs`)
    await settleOrderPayment(container as never, orderId, { funding: "card_clearing", order })
    completed = true
  }

  await syncPayoutHolds(container, hawala, order)
  const refund = await postRefundDelta(hawala, order, purchase)
  if (refund) return refund
  return { outcome: settledNow ? "settled" : completed ? "completed_partial_settlement" : "in_step" }
}

/**
 * Hold every seller on the collection while part of its refund is assigned
 * to no order; release them once all of it is (SD-40). A failure here is
 * logged, never thrown: the refund still must not be guessed, and the next
 * run retries.
 */
async function syncPayoutHolds(
  container: Container,
  hawala: HawalaLedgerModuleService,
  order: CardSettlementOrder
): Promise<void> {
  const collectionId = order.payment_collection_ids[0]
  if (!collectionId) return
  try {
    if (order.refund_attribution === "gap" && order.unattributed_refund !== null && order.unattributed_refund > 0) {
      const { order_ids, seller_ids } = await sellersForPaymentCollection(container, collectionId)
      await hawala.placePayoutHolds({
        payment_collection_id: collectionId,
        seller_ids,
        amount: order.unattributed_refund,
        currency_code: order.currency_code || "usd",
        order_ids,
      })
    } else if (order.refund_attribution === "complete") {
      await hawala.releasePayoutHolds({
        payment_collection_id: collectionId,
        released_by: "system",
        release_reason: "every refund on the collection is now recorded on a seller's order",
      })
    }
    // An open card dispute (SD-43): every seller on the collection is held
    // until it closes; a lost one then posts as a refund, a won one posts
    // nothing.
    if (order.dispute_open > 0) {
      const { order_ids, seller_ids } = await sellersForPaymentCollection(container, collectionId)
      await hawala.placePayoutHolds({
        payment_collection_id: collectionId,
        seller_ids,
        amount: order.dispute_open,
        currency_code: order.currency_code || "usd",
        order_ids,
        reason: "card_dispute_open",
      })
    } else {
      await hawala.releasePayoutHolds({
        payment_collection_id: collectionId,
        released_by: "system",
        release_reason: "no card dispute is open on the collection",
        reason: "card_dispute_open",
      })
    }
  } catch (error) {
    log.error(`[Hawala] Card order ${order.id}: could not update payout holds on ${collectionId}:`, error)
  }
}

async function postRefundDelta(
  hawala: HawalaLedgerModuleService,
  order: CardSettlementOrder,
  purchase: { debit_account_id: string }
): Promise<CardOrderReconcileResult | null> {
  if (order.unattributed_refund !== null && order.unattributed_refund > 0) {
    log.error(
      `[Hawala] Card order ${order.id}: ${order.unattributed_refund} was refunded on its shared payment collection ` +
        `with no per-order record (a Medusa-native refund or admin cancel on a Mercur cart); not posted to any seller — needs a person`
    )
    return { outcome: "unattributed_refund" }
  }
  const refundedCents = order.refunded === null ? 0 : toCents(order.refunded)
  const customerRefundLegs = (
    await hawala.listLedgerEntries({ order_id: order.id, entry_type: "REFUND", status: "COMPLETED" })
  ).filter((e) => e.credit_account_id === purchase.debit_account_id)
  const postedCents = customerRefundLegs.reduce((sum, e) => sum + toCents(Number(e.amount)), 0)
  const deltaCents = refundedCents - postedCents
  if (deltaCents <= 0) return null
  try {
    await hawala.processRefund({
      order_id: order.id,
      refund_amount: deltaCents / 100,
      reason: `Card refund on order ${order.id}`,
      idempotency_key: `card-refund-${order.id}-to-${refundedCents}`,
    })
  } catch (error) {
    log.error(
      `[Hawala] Card order ${order.id}: refund of ${deltaCents / 100} refused (${(error as Error)?.message ?? error}); ` +
        `nothing posted, retried by the reconciler`
    )
    return { outcome: "refund_refused" }
  }
  return { outcome: "refund_posted", refunded_cents: deltaCents }
}
