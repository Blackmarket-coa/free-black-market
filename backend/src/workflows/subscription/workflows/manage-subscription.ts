import {
  createWorkflow,
  when,
  WorkflowResponse
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import { updateSubscriptionStep } from "../steps/update-subscription"
import { emitSubscriptionStateStep } from "../steps/emit-subscription-state"
import { revokeSubscriptionEntitlementsStep } from "../steps/revoke-subscription-entitlements"
import { planSubscriptionCancelStep } from "../steps/plan-subscription-cancel"
import { featureFlagState } from "../../../shared/feature-flags"

type WorkflowInput = {
  subscription_id: string
  action: "pause" | "resume" | "cancel"
  reason?: string
}

export const SUBSCRIPTION_CANCELED_EVENT = "subscription.canceled"

/**
 * Whether a manageSubscriptionWorkflow run publishes `subscription.canceled`:
 * only on a cancel that actually ended the subscription (status `canceled`),
 * and only while the Black Mask provisioning flag (its sole consumer) is on.
 * A cancel that started grace (FF_CONSUMER_SUBSCRIPTIONS_V1) leaves the
 * subscription PAST_DUE with access kept and `canceled_at` stamped; Black Mask
 * hears `grace_started` then `read_only` from grace-lifecycle.ts instead, so a
 * paid-through member is not deprovisioned early.
 */
export function shouldEmitSubscriptionCanceled(
  input: Pick<WorkflowInput, "action">,
  subscription: { status?: string } | undefined
): boolean {
  return (
    input.action === "cancel" &&
    subscription?.status === "canceled" &&
    featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")
  )
}

/**
 * Manage Subscription Workflow
 *
 * Handles subscription lifecycle actions:
 * - Pause: Temporarily suspend subscription
 * - Resume: Reactivate paused subscription
 * - Cancel: Permanently end subscription
 *
 * With FF_CONSUMER_SUBSCRIPTIONS_V1 on and a grace length configured, a cancel
 * of an ACTIVE/PAUSED subscription instead starts grace (PAST_DUE) through the
 * paid period: no entitlement is revoked and Blackout is not told the member
 * lapsed until grace ends (grace-lifecycle.ts). Flag off — or no grace length,
 * or a refund-driven cancel (REFUND_CANCEL_REASON) — the cancel runs exactly
 * as before.
 */
export const manageSubscriptionWorkflowId = "manage-subscription-workflow"
export const manageSubscriptionWorkflow = createWorkflow(
  manageSubscriptionWorkflowId,
  (input: WorkflowInput) => {
    const plan = planSubscriptionCancelStep({
      subscription_id: input.subscription_id,
      action: input.action,
      reason: input.reason,
    })

    const { subscription } = updateSubscriptionStep({
      subscription_id: input.subscription_id,
      action: input.action,
      reason: input.reason,
      cancel_plan: plan,
    })

    // Gap E: a canceled subscription must drop its features.* grants — the
    // webhook below reports the member as lapsed, and the entitlement read
    // side has to agree. Pause deliberately keeps grants (grace semantics);
    // expiry is swept by `process-subscription-renewals`.
    when(
      "revoke-entitlements-on-cancel",
      { input, subscription },
      (data) =>
        data.input.action === "cancel" &&
        // A grace cancel keeps access; only a cancel that actually ended the
        // subscription (legacy, or grace not configured) revokes.
        (data.subscription as { status?: string } | undefined)?.status === "canceled"
    ).then(() =>
      revokeSubscriptionEntitlementsStep({
        subscription_id: input.subscription_id,
        reason: "subscription_canceled",
      })
    )

    // `subscription.canceled` exists for the Black Mask provisioning channel
    // only, so it is published only while FF_BLACK_MASK_PROVISIONING_V1 is on
    // (the condition is evaluated per run, not at composition), and only when
    // the cancel ended the subscription rather than starting grace. Released
    // only when the workflow succeeds.
    when(
      "emit-subscription-canceled-when",
      { input, subscription },
      (data) =>
        shouldEmitSubscriptionCanceled(
          data.input,
          data.subscription as { status?: string } | undefined
        )
    ).then(() =>
      emitEventStep({
        eventName: SUBSCRIPTION_CANCELED_EVENT,
        data: { subscription_id: input.subscription_id },
      }).config({ name: "emit-subscription-canceled" })
    )

    // Mirror the lifecycle change to Blackout: pause/cancel lapse the member's
    // Space access, resume reactivates it. `action` is a subset of
    // SubscriptionTransition, so it maps straight through.
    // A cancel that started (or happened during) grace keeps Space access
    // open; the lapse is sent when grace ends.
    when(
      "emit-blackout-subscription-state",
      { input, subscription },
      (data) =>
        data.input.action !== "cancel" ||
        (data.subscription as { status?: string } | undefined)?.status === "canceled"
    ).then(() => {
      emitSubscriptionStateStep({ subscription, transition: input.action })
    })

    return new WorkflowResponse({
      subscription,
      action: input.action,
      success: true
    })
  }
)
