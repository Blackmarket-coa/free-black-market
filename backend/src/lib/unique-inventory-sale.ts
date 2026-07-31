/**
 * Pure decision logic for the one-of-a-kind (`unique_inventory`) sale rule:
 * once the single unit sells, the listing is retired — status back to draft,
 * stock zeroed, and `metadata.unique_inventory_sold=true` stamped so it can
 * never be re-listed (see docs/LISTING_TYPES.md). Kept free of container / DB
 * access so it is unit-testable; the `unique-inventory-sold` subscriber does
 * the I/O.
 */

export const UNIQUE_INVENTORY_CATALOG_ID = "unique_inventory"

export type UniqueInventoryOrderItem = {
  product_id?: string | null
  variant_id?: string | null
}

export type UniqueInventoryProduct = {
  id: string
  status?: string | null
  metadata?: Record<string, unknown> | null
  /** Resolved via the listing-type-product link (`listing_type.catalog_id`). */
  listing_type?: { catalog_id?: string | null } | null
}

export type UniqueInventorySaleUpdate = {
  product_id: string
  /** Sold variants whose stock levels should be zeroed. */
  variant_ids: string[]
  product_update: {
    id: string
    status: "draft"
    metadata: Record<string, unknown>
  }
}

/**
 * Decide which order items sold a `unique_inventory` listing and what updates
 * retire each one. Idempotent: a product already stamped
 * `metadata.unique_inventory_sold` yields no update, so duplicate
 * `order.placed` deliveries are harmless.
 */
export function planUniqueInventorySaleUpdates(args: {
  items: UniqueInventoryOrderItem[]
  products: UniqueInventoryProduct[]
  order_id?: string | null
}): UniqueInventorySaleUpdate[] {
  const variantsByProduct = new Map<string, Set<string>>()
  for (const item of args.items ?? []) {
    if (!item?.product_id) continue
    let variants = variantsByProduct.get(item.product_id)
    if (!variants) {
      variants = new Set<string>()
      variantsByProduct.set(item.product_id, variants)
    }
    if (item.variant_id) {
      variants.add(item.variant_id)
    }
  }

  const updates: UniqueInventorySaleUpdate[] = []
  const seen = new Set<string>()
  for (const product of args.products ?? []) {
    if (!product?.id || seen.has(product.id)) continue
    seen.add(product.id)

    const soldVariants = variantsByProduct.get(product.id)
    if (!soldVariants) continue
    if (product.listing_type?.catalog_id !== UNIQUE_INVENTORY_CATALOG_ID) {
      continue
    }
    if (product.metadata?.unique_inventory_sold === true) {
      // Already retired by an earlier delivery of this (or another) sale.
      continue
    }

    updates.push({
      product_id: product.id,
      variant_ids: [...soldVariants],
      product_update: {
        id: product.id,
        status: "draft",
        metadata: {
          ...(product.metadata ?? {}),
          unique_inventory_sold: true,
          ...(args.order_id
            ? { unique_inventory_sold_order_id: args.order_id }
            : {}),
        },
      },
    })
  }
  return updates
}
