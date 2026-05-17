import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { SubscriptionData } from "../../../modules/subscription/types"
import { decideDunningAction } from "../../../modules/subscription/utils/dunning"

export type RecordSubscriptionDunningInput = {
  subscription_id: string
  error?: string
  /**
   * After this many cumulative attempts, the workflow should pause the
   * subscription rather than scheduling another retry. Defaults to 3.
   */
  max_attempts?: number
  /**
   * Backoff schedule (days from now). Index = current attempt count.
   * Attempts beyond the array length use the last entry. Defaults to
   * [1, 3, 7].
   */
  retry_days?: number[]
}

export type RecordSubscriptionDunningOutput = {
  subscription: SubscriptionData
  attempts: number
  paused: boolean
  next_retry_at: Date | null
}

/**
 * Record a dunning attempt against a subscription. Decision logic lives in
 * `modules/subscription/utils/dunning.ts` so it can be unit-tested without
 * the container.
 */
export const recordSubscriptionDunningStep = createStep(
  "record-subscription-dunning",
  async (
    {
      subscription_id,
      error,
      max_attempts,
      retry_days,
    }: RecordSubscriptionDunningInput,
    { container }
  ) => {
    const service: SubscriptionModuleService =
      container.resolve(SUBSCRIPTION_MODULE)

    const updated = await service.recordDunningAttempt(subscription_id, error)
    const attempts = Number(
      ((updated.metadata as Record<string, unknown>) || {}).dunning_attempts ??
        0
    )

    const decision = decideDunningAction({
      attempts,
      max_attempts,
      retry_days,
      error: error ?? null,
    })

    if (decision.kind === "pause") {
      const paused = await service.pauseSubscriptionWithReason(
        subscription_id,
        decision.reason
      )
      return new StepResponse<RecordSubscriptionDunningOutput>({
        subscription: paused,
        attempts,
        paused: true,
        next_retry_at: null,
      })
    }

    const [withRetry] = await service.updateSubscriptions({
      selector: { id: subscription_id },
      data: { next_order_date: decision.next_retry_at },
    })

    return new StepResponse<RecordSubscriptionDunningOutput>({
      subscription: withRetry,
      attempts,
      paused: false,
      next_retry_at: decision.next_retry_at,
    })
  }
)
