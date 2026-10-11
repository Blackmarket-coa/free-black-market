import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-card-capture")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { ordersForPaymentCollection, readPayment } from "../lib/card-order-settlement"
import { reconcileCardOrder } from "../lib/card-order-reconcile"
import { cardOrderLedgerEnabled } from "./hawala-order-payment"
import { RENEWAL_RECORD_PROVIDER_ID } from "../workflows/subscription/renew-helpers"
import { featureFlagState } from "../shared/feature-flags"

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
 * a no-op. Only FBM's own Stripe registration; anything else is ignored —
 * except, with FF_CONSUMER_SUBSCRIPTIONS_V1, a system-provider capture, which
 * is how a subscription renewal FBM already charged is recorded (SD-46). The
 * reconcile decides whether that order really is card money (the order must
 * be linked to the subscription its payment names), so a manual payment's
 * capture reconciles to "not a card order" and posts nothing.
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
    const renewalRecord = payment.provider_id === RENEWAL_RECORD_PROVIDER_ID && featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")
    if ((!isFbmCardProvider(payment.provider_id) && !renewalRecord) || !payment.payment_collection_id) return

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
