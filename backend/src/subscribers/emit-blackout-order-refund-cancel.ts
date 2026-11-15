import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackout-order-refund-cancel")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import {
  orderSellerId,
  resolveBlackoutUserId,
  resolveCustomerMxid,
  resolveSellerMxid,
} from "../lib/blackout-identity"
import { mapEntitlementKindToBlackout } from "../modules/marketplace-webhooks/models/blackout-events"

/**
 * Emit Blackout events on refund / cancel:
 *  - §2 `purchase.refunded` per line item (revokes the entitlement), and
 *  - §3 `order.cancelled` on cancel,
 *  - companion `entitlements.changed` so Blackout re-syncs ACLs promptly.
 *
 * Runs alongside `revoke-entitlements-on-refund` (which mutates entitlement
 * state); this one only emits. Idempotent via stable eventIds.
 *
 * `order.cancelled` goes to the vendor's room: the order's seller through
 * Mercur's link (`seller.id`). An order with no seller link sends no
 * `order.cancelled`; the other events do not depend on the seller.
 */
export default async function emitBlackoutOrderRefundCancel({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  const isCancel = event.name === "order.canceled"

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "customer_id",
        "currency_code",
        "metadata",
        // `seller.id` (Mercur's link), not `seller_id`, which Order does not
        // have: it read as absent and order.cancelled went to "default-seller".
        "seller.id",
        "items.id",
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
    const sellerId = orderSellerId(order)
    // The buyer's id only, as before: the seller fallback inside
    // resolveBlackoutUserId never ran while `seller_id` read as absent, and a
    // refund revokes from the buyer, never from the vendor's own account.
    const userId = await resolveBlackoutUserId(container, {
      customerId: order.customer_id ?? null,
      sellerId: null,
      orderMetadata: metadata,
    })

    if (isCancel) {
      if (!sellerId) {
        log.warn(`[emit-blackout-order-refund-cancel] order ${orderId} has no seller link; order.cancelled not sent`)
      } else {
        const vendorMxid = await resolveSellerMxid(container, sellerId)
        await emitBlackoutEvent(
          container,
          "order.cancelled",
          {
            vendorId: sellerId,
            ...(userId ? { userId } : {}),
            orderId,
            reason: (metadata.cancel_reason as string) ?? undefined,
            ...(vendorMxid ? { vendorMxid } : {}),
          },
          { eventId: `order.cancelled:${orderId}` }
        )
      }
    } else if (userId) {
      for (const it of (order.items || []) as any[]) {
        const kind = mapEntitlementKindToBlackout(
          (it.metadata?.entitlement_kind ?? null) as string | null
        )
        const providerListingId =
          (it.metadata?.listing_id as string | undefined) ??
          it.product_id ??
          it.variant_id ??
          it.id
        await emitBlackoutEvent(
          container,
          "purchase.refunded",
          { userId, providerListingId, sku: it.variant_sku ?? null, kind },
          { eventId: `purchase.refunded:${orderId}:${it.id}`, metadata: { fbmOrderId: orderId } }
        )
      }
    }

    // Companion: tell Blackout an access-affecting change happened.
    if (order.customer_id) {
      const mxid = await resolveCustomerMxid(container, order.customer_id)
      if (mxid) {
        await emitBlackoutEvent(
          container,
          "entitlements.changed",
          { mxid, reason: isCancel ? "order_cancelled" : "order_refunded" },
          { eventId: `entitlements.changed:${orderId}:${isCancel ? "cancel" : "refund"}` }
        )
      }
    }
  } catch (err) {
    log.error(`[emit-blackout-order-refund-cancel] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: ["order.canceled", "order.refund_created"],
}
