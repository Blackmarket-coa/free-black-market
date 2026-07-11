import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Best-effort read of a seller's marketplace orders, following the pattern
 * established by `api/vendor/farm/grower-dashboard`: resolve the seller's
 * product ids through the seller→product link, then fetch orders containing
 * those products. Items on each order are pre-filtered to the seller's own
 * products so multi-vendor orders don't leak (or double-count) other sellers'
 * lines. Returns [] on any failure — dashboards must render without orders.
 */

export interface SellerOrderItem {
  product_id: string
  title: string
  quantity: number
  unit_price: number
}

export interface SellerOrder {
  id: string
  display_id?: number | string
  created_at: string | Date
  email?: string | null
  fulfillment_status?: string | null
  buyer_name: string
  destination_state: string
  items: SellerOrderItem[]
  /** Sum of this seller's items only, in cents. */
  seller_total_cents: number
}

export async function getSellerOrders(
  container: MedusaContainer,
  sellerId: string
): Promise<SellerOrder[]> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
      graph: (a: Record<string, unknown>) => Promise<{ data: any[] }>
    }

    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id", "products.id"],
      filters: { id: sellerId },
    })
    const productIds: string[] = (sellers?.[0]?.products ?? [])
      .map((p: { id?: string }) => p?.id)
      .filter((x: string | undefined): x is string => !!x)
    if (productIds.length === 0) return []

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "created_at",
        "email",
        "fulfillment_status",
        "shipping_address.first_name",
        "shipping_address.last_name",
        "shipping_address.province",
        "items.product_id",
        "items.title",
        "items.quantity",
        "items.unit_price",
      ],
      filters: { items: { product_id: productIds } },
    })

    return (orders ?? []).map((o: any) => {
      const items: SellerOrderItem[] = (o.items ?? [])
        .filter((it: any) => it?.product_id && productIds.includes(it.product_id))
        .map((it: any) => ({
          product_id: it.product_id,
          title: String(it.title ?? ""),
          quantity: Number(it.quantity ?? 0),
          unit_price: Number(it.unit_price ?? 0),
        }))
      const first = o.shipping_address?.first_name ?? ""
      const last = o.shipping_address?.last_name ?? ""
      return {
        id: o.id,
        display_id: o.display_id,
        created_at: o.created_at,
        email: o.email ?? null,
        fulfillment_status: o.fulfillment_status ?? null,
        buyer_name: `${first} ${last}`.trim() || (o.email ?? "Customer"),
        destination_state: String(o.shipping_address?.province ?? ""),
        items,
        seller_total_cents: items.reduce(
          (s, it) => s + it.unit_price * it.quantity,
          0
        ),
      }
    })
  } catch {
    return []
  }
}

/** Fulfillment statuses that mean the order still needs vendor action. */
export function isPendingFulfillment(status: string | null | undefined): boolean {
  if (!status) return true
  return !["shipped", "partially_delivered", "delivered", "canceled"].includes(status)
}
