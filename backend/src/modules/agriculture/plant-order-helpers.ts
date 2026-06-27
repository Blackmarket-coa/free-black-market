/**
 * Plant Network — shared order→node resolution.
 *
 * Loads an order's line items joined to their product's plant metadata and
 * owning MercurJS seller, so the payout (§2), fulfillment (§6) and dashboard
 * (§8) layers all read node attribution the same way.
 *
 * Identity (confirmed design): a product's `grower_node` is a *label*; the
 * real payee/fulfiller is the product's owning `seller_id`. We surface both.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { GrowerNode, PropMethod } from "../../types/plant"

export interface OrderNodeItem {
  line_item_id: string
  product_id: string | null
  variant_id: string | null
  seller_id: string | null
  grower_node: GrowerNode | null
  prop_method: PropMethod | null
  unit_price_cents: number
  quantity: number
  gross_cents: number
  is_live_plant: boolean
  requires_phyto_cert: boolean
  title: string | null
}

export interface OrderNodeContext {
  order_id: string
  currency_code: string
  ship_to_province: string | null
  ship_to_country: string | null
  items: OrderNodeItem[]
}

type QueryLike = { graph: (args: Record<string, unknown>) => Promise<{ data: any[] }> }

/**
 * Resolve order line items with their product plant-metadata + seller.
 * Returns null if the order can't be found.
 */
export async function loadOrderNodeContext(
  container: { resolve: (k: string) => unknown },
  orderId: string
): Promise<OrderNodeContext | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "currency_code",
      "shipping_address.province",
      "shipping_address.country_code",
      "items.id",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "items.product_id",
      "items.variant_id",
    ],
    filters: { id: orderId },
  })

  const order = orders?.[0]
  if (!order) return null

  const rawItems = (order.items || []) as Array<{
    id: string
    title?: string | null
    quantity?: number | null
    unit_price?: number | null
    product_id?: string | null
    variant_id?: string | null
  }>

  // Join product metadata + seller in one graph query.
  const productIds = Array.from(
    new Set(rawItems.map((i) => i.product_id).filter((x): x is string => !!x))
  )

  const productInfo = new Map<
    string,
    { sellerId: string | null; metadata: Record<string, unknown> }
  >()

  if (productIds.length > 0) {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "metadata", "seller.id"],
      filters: { id: productIds },
    })
    for (const p of (products ?? []) as Array<{
      id: string
      metadata?: Record<string, unknown> | null
      seller?: { id: string } | null
    }>) {
      if (!p?.id) continue
      productInfo.set(p.id, {
        sellerId: p.seller?.id ?? null,
        metadata: (p.metadata ?? {}) as Record<string, unknown>,
      })
    }
  }

  const items: OrderNodeItem[] = rawItems.map((it) => {
    const info = it.product_id ? productInfo.get(it.product_id) : undefined
    const meta = (info?.metadata ?? {}) as Record<string, unknown>
    const unit = Number(it.unit_price ?? 0)
    const qty = Number(it.quantity ?? 0)
    return {
      line_item_id: it.id,
      product_id: it.product_id ?? null,
      variant_id: it.variant_id ?? null,
      seller_id: info?.sellerId ?? null,
      grower_node: (meta.grower_node as GrowerNode | undefined) ?? null,
      prop_method: (meta.prop_method as PropMethod | undefined) ?? null,
      unit_price_cents: unit,
      quantity: qty,
      gross_cents: unit * qty,
      is_live_plant: meta.is_live_plant === true,
      requires_phyto_cert: meta.requires_phyto_cert === true,
      title: it.title ?? null,
    }
  })

  return {
    order_id: order.id,
    currency_code: String(order.currency_code || "usd"),
    ship_to_province: order.shipping_address?.province ?? null,
    ship_to_country: order.shipping_address?.country_code ?? null,
    items,
  }
}

/** Group node items by the resolved payee seller_id (skipping items with none). */
export function groupItemsBySeller(
  items: OrderNodeItem[]
): Map<string, OrderNodeItem[]> {
  const bySeller = new Map<string, OrderNodeItem[]>()
  for (const item of items) {
    if (!item.seller_id) continue
    const list = bySeller.get(item.seller_id) ?? []
    list.push(item)
    bySeller.set(item.seller_id, list)
  }
  return bySeller
}

export const centsToDollars = (cents: number): number => cents / 100
