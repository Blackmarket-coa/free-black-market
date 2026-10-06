import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-card-capture")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { cardOrderLedgerEnabled, settleOrderPayment } from "./hawala-order-payment"

/**
 * Settle a card order when Stripe captures it (SD-36,
 * `FF_CARD_ORDER_LEDGER_V1`, hawala-ledger/card-clearing.ts).
 *
 * FBM's Stripe provider runs in manual capture, so at `order.placed` a card
 * order's money is only authorised and the placement subscriber leaves it
 * alone. This is where it settles: the purchase leg debits the card-clearing
 * account (money that arrived through FBM's Stripe account), then the usual
 * fee / processing / seller legs — the same `settleOrderPayment` the
 * placement path runs, so the breakdown record, fee-first split, consignment
 * fan-out, recovery and Blackout event are all identical.
 *
 * Settles once, when the payment COLLECTION is fully captured (a partial
 * capture waits for the rest; Medusa emits this event per capture). The
 * `-purchase` idempotency key makes a redelivery, or a second capture event
 * on an already-settled order, a no-op. Only FBM's own Stripe registration:
 * a Stripe Connect direct charge, or any other provider, is ignored.
 *
 * Flag off: returns before any read.
 */
export default async function hawalaCardCaptureSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!cardOrderLedgerEnabled()) return

  const paymentId = event.data.id
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "payment",
      fields: [
        "id",
        "provider_id",
        "captured_at",
        "payment_collection.id",
        "payment_collection.amount",
        "payment_collection.captured_amount",
        "payment_collection.order.id",
      ],
      filters: { id: paymentId },
    })
    const payment = (data as Array<Record<string, unknown>>)[0] as
      | {
          id: string
          provider_id?: string | null
          payment_collection?: {
            id?: string
            amount?: unknown
            captured_amount?: unknown
            order?: { id?: string | null } | null
          } | null
        }
      | undefined

    if (!payment) {
      log.warn(`[Hawala] Captured payment ${paymentId} not found; nothing settled`)
      return
    }
    if (!isFbmCardProvider(payment.provider_id)) return

    const orderId = payment.payment_collection?.order?.id
    if (!orderId) {
      log.info(`[Hawala] Captured payment ${paymentId} belongs to no order; nothing settled`)
      return
    }

    const amount = Number(payment.payment_collection?.amount)
    const captured = Number(payment.payment_collection?.captured_amount)
    if (!Number.isFinite(amount) || !Number.isFinite(captured) || captured < amount) {
      log.info(
        `[Hawala] Order ${orderId}: payment collection captured ${payment.payment_collection?.captured_amount} ` +
          `of ${payment.payment_collection?.amount}; settles once fully captured`
      )
      return
    }

    await settleOrderPayment(container, orderId, { funding: "card_clearing", paymentId })
  } catch (error) {
    // Same rule as placement: a ledger failure never fails the capture.
    log.error(`[Hawala] Error settling captured payment ${paymentId}:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
