/**
 * How many units of a variant a buyer may still add to a cart.
 *
 * Medusa reports `inventory_quantity` only for a variant it counts, and only
 * when the request asked for it. Stock limits a purchase only where a count
 * was reported: no count is not zero.
 *
 * - A variant with `manage_inventory: false` (a digital product, print on
 *   demand, a service, an imported listing) carries no quantity at all. The
 *   product page read that absence as zero and showed "OUT OF STOCK" on a
 *   disabled button. Such a variant, and one that may be backordered, is not
 *   limited by stock: the cart accepts it whatever the count.
 * - A counted variant carries no quantity either when the page had to ask
 *   without the count (`productPageQuery({ stock: false })`: Medusa refuses to
 *   count stock for a publishable key that does not resolve to one sales
 *   channel). The page then offers it and the cart, which does know the
 *   stock, refuses it if there is none left.
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
  return variant.inventory_quantity ?? Infinity
}
