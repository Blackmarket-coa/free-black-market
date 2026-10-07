import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-card-stripe-events")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { PaymentWebhookEvents } from "@medusajs/framework/utils"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { verifyStripePaymentWebhook, type PaymentWebhookInput } from "../lib/stripe-payment-webhook"
import { chargeIdOfStripeEvent, syncCardChargeFromStripe } from "../lib/card-stripe-sync"
import { cardOrderLedgerEnabled } from "./hawala-order-payment"

/**
 * Stripe charge and dispute events into the card-order ledger (SD-43,
 * `lib/card-stripe-sync.ts`; FF_CARD_ORDER_LEDGER_V1).
 *
 * Hook point: Medusa's own payment webhook (`payment.webhook_received`), as
 * `emit-blackout-stripe-payment-events.ts` does — no new endpoint, the
 * signature verified against the same `STRIPE_WEBHOOK_SECRET` before
 * anything is read, and only for FBM's own Stripe registration
 * (`pp_stripe_stripe` and its method variants). Stripe delivers only the
 * event types ticked on that endpoint: `charge.refunded`,
 * `charge.refund.updated` and `charge.dispute.*` must be enabled there for
 * this to see anything.
 *
 * Flag off: returns before verifying. Errors are logged and swallowed so a
 * ledger problem never makes Medusa retry Stripe's webhook; the event is a
 * trigger only, and the next one re-reads the whole charge.
 */
export default async function hawalaCardStripeEvents({ event: { data }, container }: SubscriberArgs<PaymentWebhookInput>) {
  if (!cardOrderLedgerEnabled()) return
  try {
    const stripeEvent = verifyStripePaymentWebhook(data, isFbmCardProvider, "[hawala-card-stripe-events]")
    if (!stripeEvent) return
    const chargeId = chargeIdOfStripeEvent(stripeEvent as never)
    if (!chargeId) return
    const result = await syncCardChargeFromStripe(container, chargeId)
    log.info(`[hawala-card-stripe-events] ${stripeEvent.type} ${chargeId}: ${result.outcome}`)
  } catch (error) {
    log.error("[hawala-card-stripe-events] failed:", error instanceof Error ? error.message : error)
  }
}

export const config: SubscriberConfig = {
  event: PaymentWebhookEvents.WebhookReceived,
  context: { subscriberId: "hawala-card-stripe-events" },
}
