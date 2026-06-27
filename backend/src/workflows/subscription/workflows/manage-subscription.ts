import { 
  createWorkflow,
  WorkflowResponse
} from "@medusajs/framework/workflows-sdk"
import { updateSubscriptionStep } from "../steps/update-subscription"
import { emitSubscriptionStateStep } from "../steps/emit-subscription-state"

type WorkflowInput = {
  subscription_id: string
  action: "pause" | "resume" | "cancel"
  reason?: string
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
