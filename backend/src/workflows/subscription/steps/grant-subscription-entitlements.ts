import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ENTITLEMENT_MODULE } from "../../../modules/entitlement"
import type EntitlementModuleService from "../../../modules/entitlement/service"

export type GrantSubscriptionEntitlementsInput = {
  subscription_id: string
  customer_id?: string | null
  product_id?: string | null
  variant_id?: string | null
  /**
   * Optional explicit order id when the renewal created one. When absent
   * (e.g. dry-run / non-order subscriptions like access passes), the
   * entitlement is keyed only by subscription_id and product_id so the
   * idempotency boundary is the renewal cycle.
   */
  order_id?: string | null
}

export type GrantSubscriptionEntitlementsOutput = {
  granted_count: number
}

/**
 * Grant the per-cycle entitlements declared by EntitlementGrantRule for the
 * subscription's product/variant. Mirrors the behavior of the
 * `grant-entitlements-on-order-placed` subscriber but with subscription
 * provenance so dashboards and downstream readers can distinguish
 * subscription-driven grants from one-time order grants.
 */
export const grantSubscriptionEntitlementsStep = createStep(
  "grant-subscription-entitlements",
  async (
    { subscription_id, customer_id, product_id, variant_id, order_id }: GrantSubscriptionEntitlementsInput,
    { container }
  ) => {
    const entitlementService = container.resolve<EntitlementModuleService>(
      ENTITLEMENT_MODULE
    )

    if (!product_id && !variant_id) {
      return new StepResponse<GrantSubscriptionEntitlementsOutput>({
        granted_count: 0,
      })
    }

    const granted = await entitlementService.grantFromOrder({
      order_id: order_id ?? subscription_id,
      customer_id: customer_id ?? null,
      items: [{ product_id: product_id ?? null, variant_id: variant_id ?? null }],
      source_subscription_id: subscription_id,
    })

    return new StepResponse<GrantSubscriptionEntitlementsOutput>({
      granted_count: granted.length,
    })
  }
)
