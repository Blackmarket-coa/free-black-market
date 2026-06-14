import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { SubscriptionStatus } from "../../../modules/subscription/types"

type StepInput = {
  limit?: number
}

/**
 * Process Subscription Renewal Step
 * 
 * Finds subscriptions due for renewal and prepares them for processing
 */
export const processSubscriptionRenewalStep = createStep(
  "process-subscription-renewal-step",
  async ({ limit = 100 }: StepInput, { container }) => {
    const subscriptionService: SubscriptionModuleService = 
      container.resolve(SUBSCRIPTION_MODULE)

    // Get subscriptions that are due for renewal
    const dueSubscriptions = await subscriptionService.getDueSubscriptions()
    
    // Filter to active ones with valid next_order_date
    const subscriptionsToProcess = dueSubscriptions
      .filter(sub => 
        sub.status === SubscriptionStatus.ACTIVE && 
        sub.next_order_date !== null
      )
      .slice(0, limit)

    return new StepResponse({
      subscriptions: subscriptionsToProcess,
      count: subscriptionsToProcess.length,
      total_due: dueSubscriptions.length
    })
  }
)
