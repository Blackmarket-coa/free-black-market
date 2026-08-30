import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ENTITLEMENT_MODULE } from "../../../modules/entitlement"
import type EntitlementModuleService from "../../../modules/entitlement/service"

export type RevokeSubscriptionEntitlementsInput = {
  subscription_id: string
  reason: string
}

/**
 * Revoke every entitlement sourced to a subscription (Gap E). Without this a
 * canceled/expired subscription kept its `features.*` grants active while the
 * Blackout webhook reported the member as lapsed — the two channels
 * disagreed. Not compensated: cancel/expire is the terminal state; a
 * resubscribe reactivates the same rows via `grant()`.
 */
export const revokeSubscriptionEntitlementsStep = createStep(
  "revoke-subscription-entitlements",
  async ({ subscription_id, reason }: RevokeSubscriptionEntitlementsInput, { container }) => {
    const entitlementService = container.resolve<EntitlementModuleService>(
      ENTITLEMENT_MODULE
    )
    const revoked_count = await entitlementService.revokeBySubscriptionId(
      subscription_id,
      reason
    )
    return new StepResponse({ revoked_count })
  }
)
