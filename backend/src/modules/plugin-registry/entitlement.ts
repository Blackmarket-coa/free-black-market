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
