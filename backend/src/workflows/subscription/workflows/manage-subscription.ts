import {
  createWorkflow,
  when,
  WorkflowResponse
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import { updateSubscriptionStep } from "../steps/update-subscription"
import { emitSubscriptionStateStep } from "../steps/emit-subscription-state"
import { revokeSubscriptionEntitlementsStep } from "../steps/revoke-subscription-entitlements"
import { featureFlagState } from "../../../shared/feature-flags"

type WorkflowInput = {
  subscription_id: string
  action: "pause" | "resume" | "cancel"
  reason?: string
}

export const SUBSCRIPTION_CANCELED_EVENT = "subscription.canceled"

/**
 * Whether a manageSubscriptionWorkflow run publishes `subscription.canceled`:
 * only on cancel, and only while the Black Mask provisioning flag (its sole
 * consumer) is on.
 */
export function shouldEmitSubscriptionCanceled(input: Pick<WorkflowInput, "action">): boolean {
  return input.action === "cancel" && featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")
}

/**
 * Manage Subscription Workflow
 *
 * Handles subscription lifecycle actions:
 * - Pause: Temporarily suspend subscription
 * - Resume: Reactivate paused subscription
 * - Cancel: Permanently end subscription
 */
export const manageSubscriptionWorkflowId = "manage-subscription-workflow"
export const manageSubscriptionWorkflow = createWorkflow(
  manageSubscriptionWorkflowId,
  (input: WorkflowInput) => {
    const { subscription } = updateSubscriptionStep({
      subscription_id: input.subscription_id,
      action: input.action,
      reason: input.reason
    })

    // Gap E: a canceled subscription must drop its features.* grants — the
    // webhook below reports the member as lapsed, and the entitlement read
    // side has to agree. Pause deliberately keeps grants (grace semantics);
    // expiry is swept by `process-subscription-renewals`.
    when(
      "revoke-entitlements-on-cancel",
      { input },
      (data) => data.input.action === "cancel"
    ).then(() =>
      revokeSubscriptionEntitlementsStep({
        subscription_id: input.subscription_id,
        reason: "subscription_canceled",
      })
    )

    // `subscription.canceled` exists for the Black Mask provisioning channel
    // only, so it is published only while FF_BLACK_MASK_PROVISIONING_V1 is on
    // (the condition is evaluated per run, not at composition). Released only
    // when the workflow succeeds.
    when(
      "emit-subscription-canceled-when",
      { input },
      (data) => shouldEmitSubscriptionCanceled(data.input)
    ).then(() =>
      emitEventStep({
        eventName: SUBSCRIPTION_CANCELED_EVENT,
        data: { subscription_id: input.subscription_id },
      }).config({ name: "emit-subscription-canceled" })
    )

    // Mirror the lifecycle change to Blackout: pause/cancel lapse the member's
    // Space access, resume reactivates it. `action` is a subset of
    // SubscriptionTransition, so it maps straight through.
    emitSubscriptionStateStep({ subscription, transition: input.action })

    return new WorkflowResponse({
      subscription,
      action: input.action,
      success: true
    })
  }
)
