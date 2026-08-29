import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ENTITLEMENT_MODULE } from "../../../modules/entitlement"
import type EntitlementModuleService from "../../../modules/entitlement/service"
import { EntitlementKind } from "../../../modules/entitlement/models"
import { MARKETPLACE_LISTING_MODULE } from "../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../modules/marketplace-listing/service"
import { resolveCustomerMxid } from "../../../lib/blackout-identity"

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
  /**
   * Blackout tier bundle inputs (W1b): when the subscription was minted from
   * a creator_listing, its feature_keys are re-granted each cycle with the
   * rolled-forward expiry, so `grant()`'s extend-on-renew branch pushes
   * `expires_at` to the new `next_order_date`.
   */
  creator_listing_id?: string | null
  seller_id?: string | null
  expires_at?: string | Date | null
}

export type GrantSubscriptionEntitlementsOutput = {
  granted_count: number
}

/**
 * Grant the per-cycle entitlements declared by EntitlementGrantRule for the
 * subscription's product/variant. Mirrors the behavior of the
 * `grant-entitlements-on-order-placed` subscriber but with subscription
 * provenance so dashboards and downstream readers can distinguish
 * subscription-driven grants from one-time order grants. For Blackout tier
 * subscriptions it additionally re-grants the listing's feature_keys bundle
 * (rule tables never cover shadow products).
 */
export const grantSubscriptionEntitlementsStep = createStep(
  "grant-subscription-entitlements",
  async (
    {
      subscription_id,
      customer_id,
      product_id,
      variant_id,
      order_id,
      creator_listing_id,
      seller_id,
      expires_at,
    }: GrantSubscriptionEntitlementsInput,
    { container }
  ) => {
    const entitlementService = container.resolve<EntitlementModuleService>(
      ENTITLEMENT_MODULE
    )

    let granted_count = 0

    if (product_id || variant_id) {
      const granted = await entitlementService.grantFromOrder({
        order_id: order_id ?? subscription_id,
        customer_id: customer_id ?? null,
        items: [{ product_id: product_id ?? null, variant_id: variant_id ?? null }],
        source_subscription_id: subscription_id,
      })
      granted_count += granted.length
    }

    if (creator_listing_id) {
      try {
        const listingService = container.resolve<MarketplaceListingService>(
          MARKETPLACE_LISTING_MODULE
        )
        const [listing] = await listingService.listCreatorListings({
          id: creator_listing_id,
        })
        const featureKeys = Array.isArray(listing?.feature_keys)
          ? (listing!.feature_keys as unknown[]).filter(
              (k): k is string => typeof k === "string" && k.length > 0
            )
          : []
        if (featureKeys.length > 0) {
          const mxid = customer_id
            ? await resolveCustomerMxid(container, customer_id)
            : null
          const bundle = await entitlementService.grantBundleFromSubscription({
            subscription_id,
            customer_id: customer_id ?? null,
            customer_external_id: mxid,
            seller_id: seller_id ?? listing?.seller_id ?? null,
            feature_keys: featureKeys,
            kind: EntitlementKind.ACCESS_PASS,
            expires_at: expires_at ? new Date(expires_at) : null,
          })
          granted_count += bundle.length
        }
      } catch {
        // Bundle grant failure must not fail the renewal order; the
        // blackout-resync route reconciles drift.
      }
    }

    return new StepResponse<GrantSubscriptionEntitlementsOutput>({
      granted_count,
    })
  }
)
