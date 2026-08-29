import {
  EntitlementKind,
  EntitlementSource,
} from "../entitlement/models/entitlement"
import type { GrantInput } from "../entitlement/service"

/**
 * Feature-key convention for plugin entitlements: `plugin:<slug>`. The install
 * API grants one, and clients verify install status against it.
 */
export function pluginFeatureKey(slug: string): string {
  return `plugin:${slug}`
}

/**
 * Build the entitlement grant for a plugin install. Manual-sourced (not tied to
 * an order) and kind=plugin so plugin grants are distinguishable from purchases.
 */
export function buildPluginGrantInput(args: {
  slug: string
  customerId: string
}): GrantInput {
  return {
    customer_id: args.customerId,
    feature_key: pluginFeatureKey(args.slug),
    kind: EntitlementKind.PLUGIN,
    source: EntitlementSource.MANUAL,
    metadata: { plugin_slug: args.slug },
  }
}

/**
 * Seller-scoped counterpart (W3): a seller install grants `plugin:<slug>`
 * keyed by `seller_id`, so vendor-facing surfaces can be entitlement-gated
 * (`verifyForSeller`/`listActiveFeatureKeysForSeller`). NOTE the grant is
 * best-effort at the route today — `seller_metadata.enabled_extensions`
 * remains the authoritative seller install record (AUDIT_DEBT W3).
 */
export function buildSellerPluginGrantInput(args: {
  slug: string
  sellerId: string
}): GrantInput {
  return {
    seller_id: args.sellerId,
    feature_key: pluginFeatureKey(args.slug),
    kind: EntitlementKind.PLUGIN,
    source: EntitlementSource.MANUAL,
    metadata: { plugin_slug: args.slug },
  }
}
