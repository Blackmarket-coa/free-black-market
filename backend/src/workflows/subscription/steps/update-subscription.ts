import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import type { CancelPlan } from "./plan-subscription-cancel"
import { startGraceForSubscription } from "../grace-lifecycle"

type StepInput = {
  subscription_id: string
  action: "record_order" | "pause" | "resume" | "cancel" | "expire" | "fail"
  reason?: string
  /**
   * From planSubscriptionCancelStep. Absent or `legacy` → the cancel runs
   * exactly as before FF_CONSUMER_SUBSCRIPTIONS_V1 existed.
   */
  cancel_plan?: CancelPlan
}

/**
 * Update Subscription Step
 * 
 * Updates subscription state based on various actions
 */
export const updateSubscriptionStep = createStep(
  "update-subscription-step",
  async ({ subscription_id, action, reason, cancel_plan }: StepInput, { container }) => {
    const subscriptionService: SubscriptionModuleService = 
      container.resolve(SUBSCRIPTION_MODULE)

    // Store previous state for compensation
    const prevSubscriptionData = await subscriptionService.retrieveSubscription(subscription_id)

    let subscription

    switch (action) {
      case "record_order":
        subscription = await subscriptionService.recordNewSubscriptionOrder(subscription_id)
        break
      case "pause":
        subscription = await subscriptionService.pauseSubscription(subscription_id)
        break
      case "resume":
        subscription = await subscriptionService.resumeSubscription(subscription_id)
        break
      case "cancel": {
        if (cancel_plan?.mode === "grace") {
          const graced = await startGraceForSubscription(
            container,
            subscription_id,
            "customer_canceled",
            { resolution: cancel_plan.resolution }
          )
          if (graced.started) {
            subscription = graced.subscription
            break
          }
        }
        if (cancel_plan?.mode === "cancel_during_grace") {
          subscription = await subscriptionService.cancelDuringGrace(subscription_id)
          break
        }
        const canceled = await subscriptionService.cancelSubscriptions(subscription_id)
        subscription = canceled[0]
        break
      }
      case "expire": {
        const expired = await subscriptionService.expireSubscription(subscription_id)
        subscription = expired[0]
        break
      }
      case "fail":
        subscription = await subscriptionService.failSubscription(subscription_id, reason)
        break
      default:
        throw new Error(`Unknown subscription action: ${action}`)
    }

    return new StepResponse({
      subscription
    }, {
      prev_data: prevSubscriptionData,
      lifecycle: !!cancel_plan && cancel_plan.mode !== "legacy",
    })
  },
  // Compensation: restore previous state
  async (data, { container }) => {
    if (!data) {
      return
    }
    const subscriptionService: SubscriptionModuleService = 
      container.resolve(SUBSCRIPTION_MODULE)

    await subscriptionService.updateSubscriptions({
      selector: { id: data.prev_data.id },
      data: {
        status: data.prev_data.status,
        last_order_date: data.prev_data.last_order_date,
        next_order_date: data.prev_data.next_order_date,
        paused_at: data.prev_data.paused_at,
        canceled_at: data.prev_data.canceled_at,
        // Only an F4 cancel touched these; a legacy action's compensation
        // writes exactly what it always wrote.
        ...(data.lifecycle
          ? {
              grace_ends_at: data.prev_data.grace_ends_at,
              grace_period_days: data.prev_data.grace_period_days,
              metadata: data.prev_data.metadata,
            }
          : {}),
      }
    })
  }
)
