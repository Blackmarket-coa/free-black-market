import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  emitSubscriptionState,
  type EmittableSubscription,
  type SubscriptionTransition,
} from "../../../lib/blackout-subscription"

type StepInput = {
  subscription: EmittableSubscription | null | undefined
  transition: SubscriptionTransition
}

/**
 * Emit the Blackout membership-sync bridge event for a subscription transition.
 *
 * Side-effect only: it enqueues onto the existing fire-and-forget Blackout
 * outbound channel and never throws, so it has no compensation — a failed or
 * skipped emit must not roll back the subscription change that triggered it.
 * The drain job ships the queued event with signing + retry.
 */
export const emitSubscriptionStateStep = createStep(
  "emit-subscription-state-step",
  async ({ subscription, transition }: StepInput, { container }) => {
    if (!subscription?.id) {
      return new StepResponse({ emitted: false, eventId: null as string | null })
    }
    const eventId = await emitSubscriptionState(container, subscription, transition)
    return new StepResponse({ emitted: !!eventId, eventId })
  }
)
