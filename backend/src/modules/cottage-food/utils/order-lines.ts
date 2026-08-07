/**
 * Resolve an order's line items into per-seller totals.
 *
 * Each seller's compliance meters must count *their own* line items, not the
 * order total — on a multi-vendor order, charging the whole basket against one
 * home baker's annual cap would be flatly wrong.
 *
 * Line-item prices in this codebase are integer cents (see the order.total
 * handling in the hawala subscribers), so no unit conversion happens here.
 */

type QueryLike = {
  graph: (args: Record<string, unknown>) => Promise<{ data: any[] }>
}

export interface SellerOrderTotal {
  seller_id: string
  gross_cents: number
  /** Summed line-item quantity — the default meal count for home kitchens. */
  quantity: number
}

/**
 * Group an order's items by the seller that owns the product.
 *
 * Returns an empty array when the order is missing or no item resolves to a
 * seller. Never throws on a malformed order — callers are subscribers, and a
 * compliance counter must not be able to fail an order's event handling.
 */
export async function resolveSellerTotalsForOrder(
  container: { resolve: (key: string) => unknown },
  orderId: string
): Promise<SellerOrderTotal[]> {
  const query = container.resolve("query") as QueryLike

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      "items.quantity",
      "items.unit_price",
      "items.product_id",
    ],
    filters: { id: orderId },
  })

  const order = orders?.[0]
  if (!order) return []

  const items = (order.items ?? []) as Array<{
    quantity?: number | null
    unit_price?: number | null
    product_id?: string | null
  }>

  const productIds = [
    ...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id)),
  ]
  if (!productIds.length) return []

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "seller.id"],
    filters: { id: productIds },
  })

  const sellerByProduct = new Map<string, string>()
  for (const p of (products ?? []) as Array<{
    id?: string
    seller?: { id?: string } | null
  }>) {
    if (p?.id && p.seller?.id) sellerByProduct.set(p.id, p.seller.id)
  }

  const totals = new Map<string, SellerOrderTotal>()
  for (const item of items) {
    const sellerId = item.product_id
      ? sellerByProduct.get(item.product_id)
      : undefined
    if (!sellerId) continue

    const quantity = Number(item.quantity ?? 0)
    const unitPrice = Number(item.unit_price ?? 0)
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) continue

    const entry = totals.get(sellerId) ?? {
      seller_id: sellerId,
      gross_cents: 0,
      quantity: 0,
    }
    entry.gross_cents += Math.round(unitPrice * quantity)
    entry.quantity += quantity
    totals.set(sellerId, entry)
  }

  return [...totals.values()]
}

/**
 * Ledger key for a platform order line.
 *
 * Scoped per seller so a multi-vendor order writes one entry per seller
 * without colliding on the unique `(source, source_id)` index.
 */
export function orderSourceId(orderId: string, sellerId: string): string {
  return `${orderId}:${sellerId}`
}
