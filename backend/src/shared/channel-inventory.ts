import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createLogger } from "./logger"
import type {
  ChannelInventoryAdjustment,
  ChannelVariantContext,
} from "../modules/channel-connector/ingestion"

const log = createLogger("shared/channel-inventory")

/**
 * Resolve a seller's SKUs to inventory context, and apply channel decrements.
 *
 * The composition point for Phase 10's central claim: **FBM and channel sales
 * decrement one pool.** Not a mirrored count, not a reconciliation job — the
 * same `Modules.INVENTORY` items the storefront and the POS already move. Two
 * stores of stock is the divergence that causes oversell, and the only way to
 * not have two is to not build the second one.
 *
 * Mirrors `workflows/pos/adjust-pos-inventory.ts` in how it applies the delta,
 * because a channel sale and an in-person sale should do the same thing to
 * stock. Where they differ, that difference is a bug.
 */

/**
 * Inventory context for every variant the seller sells, keyed by SKU.
 *
 * Reads the seller's own catalogue through the `seller_product` link — the same
 * resolution `shared/channel-products.ts` uses to decide what to push — so what
 * a channel can sell and what FBM will decrement cannot describe different sets
 * of products.
 */
export async function loadSellerVariantContexts(
  container: MedusaContainer,
  sellerId: string
): Promise<ChannelVariantContext[]> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "seller_product",
      fields: [
        "product.variants.id",
        "product.variants.sku",
        "product.variants.manage_inventory",
        "product.variants.inventory_items.inventory_item_id",
        "product.variants.inventory_items.inventory.location_levels.location_id",
      ],
      filters: { seller_id: sellerId },
    })

    const contexts: ChannelVariantContext[] = []

    for (const row of data ?? []) {
      // Via `unknown`: `query.graph` rows are typed against generated link
      // types, and those are not structurally comparable to the narrow shape
      // read here. `medusa build` typechecks with those generated types even
      // though a plain `tsc -p tsconfig.json` does not, so a direct cast
      // compiles locally and fails the real build.
      const variants =
        (row as unknown as { product?: { variants?: unknown[] } }).product
          ?.variants ?? []

      for (const raw of variants) {
        const variant = raw as {
          id?: string
          sku?: string | null
          manage_inventory?: boolean
          inventory_items?: {
            inventory_item_id?: string
            inventory?: {
              location_levels?: { location_id?: string }[]
            }
          }[]
        }

        const sku = variant.sku?.trim()
        if (!sku || !variant.id) continue

        const link = variant.inventory_items?.[0]
        contexts.push({
          sku,
          variant_id: variant.id,
          manage_inventory: variant.manage_inventory !== false,
          inventory_item_id: link?.inventory_item_id ?? null,
          // First location level. A multi-location seller needs a routing rule
          // rather than a guess, and inventing one here would silently pick a
          // warehouse — so this stays the simple case and anything else is
          // reported as `no_location_level` rather than approximated.
          location_id:
            link?.inventory?.location_levels?.[0]?.location_id ?? null,
        })
      }
    }

    return contexts
  } catch (err) {
    // No context means no decrements planned, and every line is reported as
    // unmatched — visible, and safer than guessing at stock.
    log.warn(`[channel-inventory] variant lookup failed for ${sellerId}`, err)
    return []
  }
}

export type AppliedAdjustment = ChannelInventoryAdjustment & { applied: boolean }

/**
 * Apply planned decrements against Medusa's inventory.
 *
 * Each adjustment is applied independently and its outcome recorded. One SKU
 * failing must not abandon the rest: the remaining lines are real sales whose
 * stock genuinely moved, and leaving them un-decremented to preserve tidiness
 * would cause exactly the oversell this is here to prevent.
 *
 * Returns what actually happened rather than throwing, so the caller can store
 * it on the order — a decrement that partly failed needs to be visible, not
 * retried blindly into a double-decrement.
 */
export async function applyChannelInventory(
  container: MedusaContainer,
  adjustments: readonly ChannelInventoryAdjustment[]
): Promise<AppliedAdjustment[]> {
  if (!adjustments.length) return []

  const inventory = container.resolve(Modules.INVENTORY) as {
    adjustInventory: (
      itemId: string,
      locationId: string,
      delta: number
    ) => Promise<unknown>
  }

  const results: AppliedAdjustment[] = []
  for (const adjustment of adjustments) {
    try {
      await inventory.adjustInventory(
        adjustment.inventory_item_id,
        adjustment.location_id,
        -adjustment.quantity
      )
      results.push({ ...adjustment, applied: true })
    } catch (err) {
      log.warn(
        `[channel-inventory] failed to decrement ${adjustment.sku} by ${adjustment.quantity}`,
        err
      )
      results.push({ ...adjustment, applied: false })
    }
  }

  return results
}
