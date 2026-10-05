import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import type SubscriptionModuleService from "../../../modules/subscription/service"
import { SubscriptionStatus } from "../../../modules/subscription/types"
import { SubscriptionTransitionError } from "../../../modules/subscription/errors"
import type { GracePeriodResolution } from "../../../modules/subscription/utils/grace"
import { createLogger } from "../../../shared/logger"
import {
  consumerSubscriptionsEnabled,
  resolveGraceForSubscription,
} from "../grace-lifecycle"

const log = createLogger("workflows/subscription/plan-subscription-cancel")

/**
 * How a manage action should be carried out.
 *
 *   - `legacy`: today's behaviour. Every action other than cancel, every
 *     cancel with FF_CONSUMER_SUBSCRIPTIONS_V1 off, a flagged cancel with no
 *     grace length configured (logged), and — flag or not — a cancel caused
 *     by a REFUND (`REFUND_CANCEL_REASON`): whether a refund ends access at
 *     once or starts grace is an open operator decision, so until it is made
 *     a refund keeps ending access immediately, as it does today.
 *   - `grace`: a flagged customer cancel of an ACTIVE/PAUSED subscription
 *     starts grace through the paid period instead of revoking at once.
 *   - `cancel_during_grace`: a flagged cancel of a subscription already in
 *     grace after a failed payment — records the cancel, drops the final
 *     charge, never shortens grace.
 */
export type CancelPlan =
  | { mode: "legacy" }
  | { mode: "grace"; resolution: NonNullable<GracePeriodResolution> }
  | { mode: "cancel_during_grace" }

/**
 * The `reason` revoke-entitlements-on-refund passes when a refunded or
 * canceled order cancels its subscription.
 */
export const REFUND_CANCEL_REASON = "order_refund_or_cancel"

export type PlanSubscriptionCancelInput = {
  subscription_id: string
  action: "pause" | "resume" | "cancel"
  reason?: string
}

/** Read-only decision step: writes nothing. */
export const planSubscriptionCancelStep = createStep(
  "plan-subscription-cancel",
  async ({ subscription_id, action, reason }: PlanSubscriptionCancelInput, { container }) => {
    if (action !== "cancel" || !consumerSubscriptionsEnabled()) {
      return new StepResponse<CancelPlan>({ mode: "legacy" })
    }
    if (reason === REFUND_CANCEL_REASON) {
      // Refund-ends-access policy is out of scope for F4 (open decision):
      // keep today's immediate end rather than silently granting grace.
      return new StepResponse<CancelPlan>({ mode: "legacy" })
    }

    const service = container.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
    const subscription = await service.retrieveSubscription(subscription_id)

    if (subscription.status === SubscriptionStatus.PAST_DUE) {
      return new StepResponse<CancelPlan>({ mode: "cancel_during_grace" })
    }
    if (subscription.status === SubscriptionStatus.READ_ONLY) {
      // The legacy cancel would revoke the read/export entitlement F4
      // promises to keep.
      throw new SubscriptionTransitionError({
        subscription_id,
        from_status: subscription.status,
        action: "cancel",
        allowed_from: [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAUSED,
          SubscriptionStatus.PAST_DUE,
        ],
      })
    }
    if (
      subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.PAUSED
    ) {
      return new StepResponse<CancelPlan>({ mode: "legacy" })
    }

    const resolution = await resolveGraceForSubscription(container, subscription)
    if (!resolution) {
      log.warn(
        `[cancel] FF_CONSUMER_SUBSCRIPTIONS_V1 is on but no grace length is configured — ` +
          `subscription ${subscription_id} is canceled immediately (pre-F4 behaviour)`
      )
      return new StepResponse<CancelPlan>({ mode: "legacy" })
    }
    return new StepResponse<CancelPlan>({ mode: "grace", resolution })
  }
)
