import type {
  AdminOrderLineItem,
  AdminProductVariant,
  AdminProductVariantInventoryItemLink,
  OrderLineItemDTO,
} from "@medusajs/types"

/**
 * Check if the line item has inventory kit. Accepts either the
 * workflow-level OrderLineItemDTO or the admin-response shape; both
 * carry the same `variant.inventory_items` join when fetched with
 * `+variant.inventory_items.*`.
 */
export function checkInventoryKit(
  item:
    | (OrderLineItemDTO & {
        variant?: AdminProductVariant & {
          inventory_items: AdminProductVariantInventoryItemLink[]
        }
      })
    | AdminOrderLineItem
) {
  const variant = item.variant as
    | (AdminProductVariant & {
        inventory_items?: AdminProductVariantInventoryItemLink[]
      })
    | undefined
    | null

  if (!variant) {
    return false
  }

  const inventoryItems = variant.inventory_items ?? []

  return (
    (!!inventoryItems.length && inventoryItems.length > 1) ||
    (inventoryItems.length === 1 &&
      (inventoryItems[0]?.required_quantity ?? 0) > 1)
  )
}
