import {
  AdminProductVariant,
  AdminProductVariantInventoryItemLink,
  OrderLineItemDTO,
} from "@medusajs/types"

/**
 * Check if the line item has inventory kit.
 */
export function checkInventoryKit(
  item: OrderLineItemDTO & {
    variant?:
      | (AdminProductVariant & {
          inventory_items?:
            | AdminProductVariantInventoryItemLink[]
            | null
        })
      | null
  }
) {
  const variant = item.variant

  if (!variant) {
    return false
  }

  const items = variant.inventory_items ?? []

  return (
    (items.length > 0 && items.length > 1) ||
    (items.length === 1 && (items[0].required_quantity ?? 0) > 1)
  )
}
