import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import type { BigNumberInput } from "@medusajs/framework/types"
import { executeRenewalCharge } from "../renewal-charge"

export type ChargeSubscriptionRenewalInput = {
  subscription_id: string
  amount: BigNumberInput
  currency_code: string
}

/**
 * Collect this cycle's renewal charge (direct off-session PaymentIntent) and
 * record it on the subscription before the period rolls. Throws on any
 * failure so the renewal job routes to dunning.
 *
 * No compensation, deliberately: money that moved is not auto-refunded when a
 * later step (order completion, link) fails. The charge stays recorded
 * `succeeded` for the cycle, so the next run completes the order WITHOUT
 * charging again (renewal-charge.ts skips a collected cycle).
 */
export const chargeSubscriptionRenewalStep = createStep(
  "charge-subscription-renewal",
  async (input: ChargeSubscriptionRenewalInput, { container }) => {
    const result = await executeRenewalCharge(container, input)
    return new StepResponse(result)
  }
)
