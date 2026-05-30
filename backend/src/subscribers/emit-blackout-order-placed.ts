import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import {
  resolveBlackoutUserId,
  resolveSellerMxid,
} from "../lib/blackout-identity"
import {
  mapEntitlementKindToBlackout,
  BLACKOUT_DEAD_DROP_KINDS,
} from "../modules/marketplace-webhooks/models/blackout-events"

/**
 * Emit Blackout events on order placement:
 *  - §2 `purchase.succeeded` per line item (drives entitlement grants + the
 *    digital dead-drop), and
 *  - §3 `order.created` once per order (routed to the vendor's orders room).
 *
 * Identity: `userId` is the Blackout user id captured at account-link time
 * (resolveBlackoutUserId). If it cannot be resolved we SKIP rather than leak a
 * non-Blackout identifier. Idempotent via stable eventIds.
 */
export default async function emitBlackoutOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "customer_id",
        "currency_code",
        "total",
        "metadata",
        "seller_id",
        "items.id",
        "items.title",
        "items.quantity",
        "items.unit_price",
        "items.product_id",
        "items.variant_id",
        "items.variant_sku",
        "items.metadata",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) return

    const metadata = (order.metadata || {}) as Record<string, unknown>
    const userId = await resolveBlackoutUserId(container, {
      customerId: order.customer_id ?? null,
      sellerId: (order as any).seller_id ?? null,
      orderMetadata: metadata,
    })

    const sellerId = (order as any).seller_id || "default-seller"
    const vendorMxid = await resolveSellerMxid(container, sellerId)
    const currency = String(order.currency_code || "USD").toUpperCase()
    const items = (order.items || []) as any[]

    // §2 purchase.succeeded — one per line item. Requires a Blackout user id.
    if (userId) {
      for (const it of items) {
        const itemKind = (it.metadata?.entitlement_kind ?? null) as string | null
        const kind = mapEntitlementKindToBlackout(itemKind)
        const digitalDelivery = BLACKOUT_DEAD_DROP_KINDS.includes(kind)
        const providerListingId =
          (it.metadata?.listing_id as string | undefined) ??
          it.product_id ??
          it.variant_id ??
          it.id

        await emitBlackoutEvent(
          container,
          "purchase.succeeded",
          {
            userId,
            providerListingId,
            sku: it.variant_sku ?? null,
            kind,
          },
          {
            eventId: `purchase.succeeded:${orderId}:${it.id}`,
            metadata: { fbmOrderId: orderId, digitalDelivery },
          }
        )
      }
    }

    // §3 order.created — one per order, routed to the vendor's orders room.
    await emitBlackoutEvent(
      container,
      "order.created",
      {
        vendorId: sellerId,
        ...(userId ? { userId } : {}),
        orderId,
        items: items.map((it) => ({
          sku: it.variant_sku ?? null,
          title: it.title ?? "",
          qty: Number(it.quantity ?? 0),
          priceCents: Math.round(Number(it.unit_price ?? 0)),
        })),
        totalCents: Math.round(Number(order.total ?? 0)),
        currency,
        ...(vendorMxid ? { vendorMxid } : {}),
      },
      { eventId: `order.created:${orderId}` }
    )
  } catch (err) {
    console.error(`[emit-blackout-order-placed] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
