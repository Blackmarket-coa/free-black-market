import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import { recordSubscriptionDunningStep } from "../steps/record-subscription-dunning"

type WorkflowInput = {
  subscription_id: string
  error?: string
  max_attempts?: number
  retry_days?: number[]
}

/**
 * Handle Subscription Failure Workflow
 *
 * Called by the renewal job when a renewal attempt fails. Records the
 * dunning attempt and either schedules a retry or pauses the subscription
 * after the configured max attempts. Always emits a
 * `subscription.payment_failed` event so notifications can be wired
 * downstream.
 */
export const handleSubscriptionFailureWorkflowId =
  "handle-subscription-failure-workflow"

export const handleSubscriptionFailureWorkflow = createWorkflow(
  handleSubscriptionFailureWorkflowId,
  (input: WorkflowInput) => {
    const dunning = recordSubscriptionDunningStep({
      subscription_id: input.subscription_id,
      error: input.error,
      max_attempts: input.max_attempts,
      retry_days: input.retry_days,
    })

    emitEventStep({
      eventName: "subscription.payment_failed",
      data: {
        subscription_id: input.subscription_id,
        error: input.error ?? null,
        attempts: dunning.attempts,
        paused: dunning.paused,
        next_retry_at: dunning.next_retry_at,
      },
    })

    return new WorkflowResponse({
      subscription: dunning.subscription,
      attempts: dunning.attempts,
      paused: dunning.paused,
      next_retry_at: dunning.next_retry_at,
    })
  }
)
