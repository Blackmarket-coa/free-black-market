import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Best-effort read of a seller's marketplace orders, following the pattern
 * established by `api/vendor/farm/grower-dashboard`: resolve the seller's
 * product ids through the seller→product link, then fetch orders containing
 * those products. Items on each order are pre-filtered to the seller's own
 * products so multi-vendor orders don't leak (or double-count) other sellers'
 * lines. Cancelled and draft orders are left out (NON_SALE_ORDER_FILTERS).
 * Returns [] on any failure — dashboards must render without orders.
 */

export interface SellerOrderItem {
  product_id: string
  title: string
  quantity: number
  /** Medusa's major units, as stored (12.5 is $12.50). */
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

/**
 * The order filters that leave out what is not a sale. Once this read worked
 * (SD-52) it listed cancelled and draft orders, and cross-channel revenue
 * (GET /vendor/revenue/channels) counted each as an FBM sale with the platform
 * fee on it. Checked on Postgres through query.graph, condition by condition,
 * in integration-tests/http/order-items-quantity-read.spec.ts:
 *
 * - `status` not "canceled" or "draft" (Medusa's OrderStatus values): the
 *   direct mark of both. Medusa's and Mercur's cancels also set
 *   `canceled_at` and a draft also has `is_draft_order`, so for orders they
 *   write the two conditions below already suffice; this one catches a
 *   status written without them;
 * - `canceled_at: null`: Medusa's archive moves a cancelled order to status
 *   "archived" and keeps its `canceled_at`, so the status alone keeps it;
 * - `is_draft_order: false`: a draft has status "draft" and is_draft_order
 *   true, and an archived draft keeps the flag (Medusa's own admin order list
 *   filters on it). A draft is never cancelled, so `canceled_at` alone keeps
 *   it.
 *
 * "pending", "completed", "requires_action" and an archived completed order
 * are sales and stay.
 */
export const NON_SALE_ORDER_FILTERS = {
  status: { $nin: ["canceled", "draft"] },
  canceled_at: null,
  is_draft_order: false,
} as const

/**
 * `since` bounds the order read in the database (created_at >= since). Without
 * it every order that ever held one of the seller's products is loaded, which
 * the nursery dashboard and payouts routes still do (SD-52 follow-up).
 */
export async function getSellerOrders(
  container: MedusaContainer,
  sellerId: string,
  opts: { since?: Date } = {}
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

    // `items.*`, never `items.quantity` (SD-52): Medusa 2.14.2 rewrites
    // `items.quantity` to `items.item.quantity`, a property OrderLineItem does
    // not have, so this read threw for every order and the catch below
    // returned [] to every caller.
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
        "items.*",
      ],
      filters: {
        items: { product_id: productIds },
        // Sales only (NON_SALE_ORDER_FILTERS), in the database.
        ...NON_SALE_ORDER_FILTERS,
        ...(opts.since ? { created_at: { $gte: opts.since } } : {}),
      },
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
        // unit_price is major units; the total is cents.
        seller_total_cents: Math.round(
          items.reduce((s, it) => s + it.unit_price * it.quantity, 0) * 100
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
