import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-card-capture")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { ordersForPaymentCollection, readPayment } from "../lib/card-order-settlement"
import { reconcileCardOrder } from "../lib/card-order-reconcile"
import { cardOrderLedgerEnabled } from "./hawala-order-payment"

/**
 * Settle card orders when Stripe captures their payment (SD-36,
 * `FF_CARD_ORDER_LEDGER_V1`, hawala-ledger/card-clearing.ts).
 *
 * The event carries only the payment id, and a payment belongs to a payment
 * COLLECTION — which on a Mercur cart is shared by one order per seller. So
 * every order whose money moved through that collection is reconciled on its
 * own (`lib/card-order-reconcile.ts`, under a per-order lock) and settled once
 * its own share is fully captured, through the same `settleOrderPayment` the
 * placement path runs.
 * Each order's `-purchase` key makes a redelivery, or a second capture event,
 * a no-op. Only FBM's own Stripe registration; anything else is ignored.
 *
 * Flag off: returns before any read. A failure here is logged, never thrown
 * (it must not fail the capture); the reconciler job settles what was missed.
 */
export default async function hawalaCardCaptureSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!cardOrderLedgerEnabled()) return

  const paymentId = event.data.id
  try {
    const payment = await readPayment(container, paymentId)
    if (!payment) {
      log.warn(`[Hawala] Captured payment ${paymentId} not found; nothing settled`)
      return
    }
    if (!isFbmCardProvider(payment.provider_id) || !payment.payment_collection_id) return

    const orderIds = await ordersForPaymentCollection(container, payment.payment_collection_id)
    if (orderIds.length === 0) {
      log.info(`[Hawala] Captured payment ${paymentId} belongs to no order; nothing settled`)
      return
    }
    // Each order through the one locked entry point for card orders: it
    // settles an order once that order's own share is fully captured.
    for (const orderId of orderIds) await reconcileCardOrder(container, orderId)
  } catch (error) {
    log.error(`[Hawala] Error settling captured payment ${paymentId}:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
