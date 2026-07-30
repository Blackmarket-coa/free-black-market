import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  planPosInventoryAdjustments,
  shapePosItems,
  type PosInventoryAdjustment,
  type PosOrderInput,
  type PosVariantInventoryContext,
} from "./pos-helpers"

/**
 * Decrement stock for a POS sale (closes the "direct order creation does not
 * decrement inventory" gap documented on `createPosOrderStep`).
 *
 * For each catalog line (variant_id) whose variant manages inventory, the
 * step resolves the linked inventory item (same
 * `product_variant_inventory_item` query as `sync-lot-inventory`) and applies
 * a delta-style `adjustInventory` of -quantity. The POS config
 * (`api/vendor/pos/config`) carries no stock-location id today, so the
 * location falls back to the inventory item's first location level.
 *
 * The payment already happened physically at the counter, so inventory
 * problems (unmanaged variant, no inventory item, no stock level, adjust
 * failure) are logged and skipped — they must never fail the sale.
 * Compensation re-increments exactly the adjustments that were applied.
 */
export const adjustPosInventoryStep = createStep(
  "adjust-pos-inventory-step",
  async (input: PosOrderInput, { container }) => {
    const logger = container.resolve("logger")
    const noop = new StepResponse(
      { adjusted: [] as PosInventoryAdjustment[] },
      { adjusted: [] as PosInventoryAdjustment[] }
    )

    // createPosOrderStep already rejected invalid payloads; a shape failure
    // here just means there is nothing to adjust.
    const shaped = shapePosItems(input.items)
    if (!shaped.ok) {
      return noop
    }
    const variantIds = [
      ...new Set(
        shaped.items
          .map((i) => i.variant_id)
          .filter((id): id is string => !!id)
      ),
    ]
    if (variantIds.length === 0) {
      return noop
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "manage_inventory"],
      filters: { id: variantIds },
    })

    const { data: links } = await query.graph({
      entity: "product_variant_inventory_item",
      fields: ["variant_id", "inventory_item_id"],
      filters: { variant_id: variantIds },
    })
    const itemIdByVariant = new Map<string, string>()
    for (const link of links ?? []) {
      if (link?.variant_id && link?.inventory_item_id) {
        itemIdByVariant.set(link.variant_id, link.inventory_item_id)
      }
    }

    const inventoryItemIds = [...new Set(itemIdByVariant.values())]
    const locationByItem = new Map<string, string>()
    if (inventoryItemIds.length > 0) {
      const { data: inventoryItems } = await query.graph({
        entity: "inventory_item",
        fields: ["id", "inventory_levels.location_id"],
        filters: { id: inventoryItemIds },
      })
      for (const item of inventoryItems ?? []) {
        const locationId = item?.inventory_levels?.[0]?.location_id
        if (item?.id && locationId) {
          locationByItem.set(item.id, locationId)
        }
      }
    }

    const context: PosVariantInventoryContext[] = (variants ?? []).map(
      (v: any) => {
        const inventoryItemId = itemIdByVariant.get(v.id) ?? null
        return {
          variant_id: v.id,
          // manage_inventory defaults to true in Medusa; only an explicit
          // false opts out.
          manage_inventory: v.manage_inventory !== false,
          inventory_item_id: inventoryItemId,
          location_id: inventoryItemId
            ? locationByItem.get(inventoryItemId) ?? null
            : null,
        }
      }
    )

    const plan = planPosInventoryAdjustments(shaped.items, context)
    for (const skip of plan.skipped) {
      logger.warn(
        `[pos/inventory] skipping stock decrement for variant ${skip.variant_id}: ${skip.reason}`
      )
    }

    const inventoryService = container.resolve(Modules.INVENTORY)
    const adjusted: PosInventoryAdjustment[] = []
    for (const adjustment of plan.adjustments) {
      try {
        await inventoryService.adjustInventory(
          adjustment.inventory_item_id,
          adjustment.location_id,
          -adjustment.quantity
        )
        adjusted.push(adjustment)
      } catch (err) {
        logger.warn(
          `[pos/inventory] failed to decrement variant ${adjustment.variant_id} ` +
            `(item ${adjustment.inventory_item_id}, location ${adjustment.location_id}) by ${adjustment.quantity}: ` +
            `${err instanceof Error ? err.message : err}`
        )
      }
    }

    return new StepResponse({ adjusted }, { adjusted })
  },
  // Compensation: re-increment exactly what was decremented.
  async (data, { container }) => {
    if (!data?.adjusted?.length) {
      return
    }
    const inventoryService = container.resolve(Modules.INVENTORY)
    const logger = container.resolve("logger")
    for (const adjustment of data.adjusted) {
      try {
        await inventoryService.adjustInventory(
          adjustment.inventory_item_id,
          adjustment.location_id,
          adjustment.quantity
        )
      } catch (err) {
        logger.error(
          `[pos/inventory] compensation failed to restore variant ${adjustment.variant_id} ` +
            `(item ${adjustment.inventory_item_id}, location ${adjustment.location_id}) by ${adjustment.quantity}: ` +
            `${err instanceof Error ? err.message : err}`
        )
      }
    }
  }
)
