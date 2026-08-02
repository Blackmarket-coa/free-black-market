import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "./logger"
import { pluginSlugsFrom } from "./extension-keys"
import { PLUGIN_REGISTRY_MODULE } from "../modules/plugin-registry"
import type PluginRegistryService from "../modules/plugin-registry/service"
import type { PluginPayee } from "../modules/payout-breakdown/plugin-revenue-share"

const log = createLogger("shared/plugin-payees")

/**
 * Which plugin developers can be paid for a seller's order.
 *
 * The two halves live in different modules — installed slugs are in
 * `seller_metadata.enabled_extensions` (seller-extension) and the author is on
 * `plugin_listing` (plugin-registry) — so neither module can answer this alone.
 *
 * Reads `enabled_extensions` rather than the `plugin:<slug>` entitlements
 * because that column is what the install endpoint writes and what the panel
 * renders from; the entitlement rows are customer-keyed (`customer_id`), so a
 * seller's installs are not addressable through them. `pluginSlugsFrom` is the
 * shared partition that keeps the slug namespace separable from the 14 `hasX`
 * dashboard keys sharing that column.
 */
export async function resolveSellerPluginPayees(
  container: MedusaContainer,
  sellerId: string
): Promise<PluginPayee[]> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: metaRows } = await query.graph({
      entity: "seller_metadata",
      fields: ["enabled_extensions"],
      filters: { seller_id: sellerId },
    })

    const slugs = pluginSlugsFrom(metaRows?.[0]?.enabled_extensions)
    if (slugs.length === 0) return []

    const registry = container.resolve<PluginRegistryService>(
      PLUGIN_REGISTRY_MODULE
    )
    const listings = (await registry.listPluginListings({
      slug: slugs,
    })) as unknown as { slug: string; author_seller_id: string | null }[]

    // A slug with no listing is dropped rather than treated as first-party:
    // it means the vendor holds an install of something no longer in the
    // catalog, and there is no author to reason about either way.
    return listings.map((l) => ({
      slug: l.slug,
      author_seller_id: l.author_seller_id ?? null,
    }))
  } catch (err) {
    // Never fail an order settlement over a revenue-share lookup. No payees
    // means the platform simply keeps its whole fee for this order, which is
    // the pre-existing behaviour.
    log.warn(
      `[plugin-payees] lookup failed for ${sellerId}; no developer share applied`,
      err
    )
    return []
  }
}
