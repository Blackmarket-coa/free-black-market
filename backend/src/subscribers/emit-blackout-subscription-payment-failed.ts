import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackout-subscription-payment-failed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { SUBSCRIPTION_MODULE } from "../modules/subscription"
import type SubscriptionModuleService from "../modules/subscription/service"
import { emitSubscriptionPaymentFailed } from "../lib/blackout-subscription"

/**
 * Bridge the internal `subscription.payment_failed` event (emitted by
 * `handleSubscriptionFailureWorkflow` on each dunning attempt) to the
 * Blackout webhook channel (W1b). Identity resolution + skip-when-unlinked
 * semantics live in `emitSubscriptionPaymentFailed`.
 */
export default async function emitBlackoutSubscriptionPaymentFailed({
  event: { data },
  container,
}: SubscriberArgs<{
  subscription_id: string
  error?: string | null
  attempts?: number | null
  paused?: boolean | null
  next_retry_at?: string | null
}>) {
  const subscriptionId = data.subscription_id
  try {
    const subscriptionService = container.resolve<SubscriptionModuleService>(
      SUBSCRIPTION_MODULE
    )
    const subscription = await subscriptionService.retrieveSubscription(subscriptionId)
    await emitSubscriptionPaymentFailed(container, subscription, {
      attempts: data.attempts ?? null,
      paused: data.paused ?? null,
      nextRetryAt: data.next_retry_at ?? null,
      error: data.error ?? null,
    })
  } catch (err) {
    log.error(
      `[emit-blackout-subscription-payment-failed] failed for subscription ${subscriptionId}:`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "subscription.payment_failed",
}
