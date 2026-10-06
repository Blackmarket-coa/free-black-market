import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-card-refund")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { ordersForPaymentCollection, readPayment } from "../lib/card-order-settlement"
import { reconcileCardOrder } from "../lib/card-order-reconcile"
import { cardOrderLedgerEnabled } from "./hawala-order-payment"

/**
 * A card refund through Medusa (`payment.refunded`, payload `{ id: payment
 * id }`) reaches the ledger here (SD-36, `FF_CARD_ORDER_LEDGER_V1`). Each order
 * on the payment's collection is reconciled against its OWN refunded figure
 * (`lib/card-order-reconcile.ts`), so only the order the money was refunded
 * on moves. Mercur's split refunds emit no event; the reconciler job covers
 * them. Flag off: returns before any read. Never throws.
 */
export default async function hawalaCardRefundSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!cardOrderLedgerEnabled()) return
  try {
    const payment = await readPayment(container, event.data.id)
    if (!payment || !isFbmCardProvider(payment.provider_id) || !payment.payment_collection_id) return
    for (const orderId of await ordersForPaymentCollection(container, payment.payment_collection_id)) {
      await reconcileCardOrder(container, orderId)
    }
  } catch (error) {
    log.error(`[Hawala] Error reconciling refunded payment ${event.data.id}:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
