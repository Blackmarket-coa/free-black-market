import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/unique-inventory-sold")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { Modules } from "@medusajs/framework/utils"
import { planUniqueInventorySaleUpdates } from "../lib/unique-inventory-sale"

/**
 * Retire one-of-a-kind (`unique_inventory`) listings the moment they sell.
 *
 * For each order item whose product's listing-type link resolves to the
 * `unique_inventory` catalog entry (see `links/listing-type-product.ts`), the
 * sold unit is the only unit: every stock level of the sold variants is
 * zeroed and the product is flipped to `draft` with
 * `metadata.unique_inventory_sold=true` so it cannot be re-listed. The
 * decision logic lives in `lib/unique-inventory-sale.ts` (pure, unit-tested);
 * this subscriber only does the I/O. Runs on every `order.placed` (storefront
 * and POS alike) and is idempotent via the metadata stamp.
 */
export default async function handleUniqueInventorySold({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id
  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "items.product_id", "items.variant_id"],
      filters: { id: orderId },
    })
    const order = orders?.[0]
    const items = (order?.items ?? []).filter(Boolean)
    if (items.length === 0) return

    const productIds = [
      ...new Set(
        items
          .map((it: any) => it.product_id)
          .filter((id: unknown): id is string => !!id)
      ),
    ]
    if (productIds.length === 0) return

    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "status", "metadata", "listing_type.catalog_id"],
      filters: { id: productIds },
    })

    const updates = planUniqueInventorySaleUpdates({
      items,
      products: products ?? [],
      order_id: orderId,
    })
    if (updates.length === 0) return

    const productService = container.resolve(Modules.PRODUCT) as any
    const inventoryService = container.resolve(Modules.INVENTORY) as any

    for (const update of updates) {
      // Zero every stock level of the sold variants so no channel can
      // oversell the unit even before the draft status propagates.
      // Best-effort: a missing inventory link must not block retiring the
      // listing (the metadata stamp is the actual re-list guard).
      try {
        await zeroVariantStockLevels(query, inventoryService, update.variant_ids)
      } catch (err) {
        log.error(
          `[unique-inventory-sold] failed to zero stock for product ${update.product_id} (order ${orderId}):`,
          err
        )
      }

      await productService.updateProducts(update.product_update.id, {
        status: update.product_update.status,
        metadata: update.product_update.metadata,
      })
      log.info(
        `[unique-inventory-sold] retired one-of-a-kind product ${update.product_id} after order ${orderId}`
      )
    }
  } catch (err) {
    log.error(`[unique-inventory-sold] failed for order ${orderId}:`, err)
  }
}

async function zeroVariantStockLevels(
  query: any,
  inventoryService: any,
  variantIds: string[]
): Promise<void> {
  if (variantIds.length === 0) return

  const { data: links } = await query.graph({
    entity: "product_variant_inventory_item",
    fields: ["variant_id", "inventory_item_id"],
    filters: { variant_id: variantIds },
  })
  const inventoryItemIds = [
    ...new Set(
      (links ?? [])
        .map((link: any) => link?.inventory_item_id)
        .filter((id: unknown): id is string => !!id)
    ),
  ]
  if (inventoryItemIds.length === 0) return

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "inventory_levels.location_id"],
    filters: { id: inventoryItemIds },
  })

  const levelUpdates: Array<{
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
  }> = []
  for (const item of inventoryItems ?? []) {
    for (const level of item?.inventory_levels ?? []) {
      if (item?.id && level?.location_id) {
        levelUpdates.push({
          inventory_item_id: item.id,
          location_id: level.location_id,
          stocked_quantity: 0,
        })
      }
    }
  }
  if (levelUpdates.length > 0) {
    await inventoryService.updateInventoryLevels(levelUpdates)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
