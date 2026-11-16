/**
 * How many units of a variant a buyer may still add to a cart.
 *
 * Medusa reports `inventory_quantity` only for a variant it counts. A variant
 * with `manage_inventory: false` (a digital product, print on demand, a
 * service, an imported listing) carries no quantity at all, and the product
 * page read that absence as zero and showed "OUT OF STOCK" on a disabled
 * button. Such a variant, and one that may be backordered, is not limited by
 * stock: the cart accepts it whatever the count.
 */
type StockVariant = {
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_quantity?: number | null
}

export const purchasableQuantity = (
  variant: StockVariant | null | undefined
): number => {
  if (!variant) return 0
  if (variant.manage_inventory === false || variant.allow_backorder === true) {
    return Infinity
  }
  return variant.inventory_quantity ?? 0
}
