import { createLogger } from "../shared/logger"
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BOOKING_MODULE } from "../modules/booking"
import { BookingStatus } from "../modules/booking/models/booking"
import type BookingService from "../modules/booking/service"
import { notifyBookingConfirmed } from "../shared/booking-notify"
import { getOrderCartMetadata } from "../lib/cart-metadata-recovery"
import { productSellerIds } from "../shared/product-sellers"
import { orderSellerId } from "../lib/blackout-identity"

const log = createLogger("subscribers/link-booking-on-order-placed")

/**
 * Best-effort: when an order carries a `booking_id`, link the order to the
 * booking, attach the customer, confirm it, and email the customer. No-ops for
 * ordinary orders.
 *
 * The id reaches the order from the cart. `GET /store/embed/bookings` returns a
 * checkout URL carrying `?booking_id=`, the storefront middleware pins it to a
 * cookie, and the cart loader POSTs it to `/store/carts/:id/booking`, which
 * validates it and writes it to cart metadata (D9-6). Until that path existed
 * the id lived only in a query string that nothing read back, so this
 * subscriber could never fire: no booking was linked, none confirmed, and no
 * confirmation email ever sent.
 *
 * Read through `getOrderCartMetadata` rather than off `order.metadata`
 * directly. `splitAndCompleteCartWorkflow` builds its order payload by hand
 * with no `metadata` key at all, so cart metadata does not survive checkout on
 * that path — D9-5, and the reason two other subscribers already recover it
 * this way.
 *
 * Only the order that sold the booking's product, by the booking's own
 * seller, confirms it: the order must carry a line for the booking's product,
 * that product must be the booking's seller's (Mercur's seller-product link),
 * and, when the order carries Mercur's seller link, that seller too. The
 * vendor config routes used to write a booking config for any product id, so
 * seller B's embed key could book seller A's product and this subscriber then
 * confirmed B's booking with A's order and A's customer (SD-81 addendum). The
 * same checks keep the other orders of a split multi-seller cart, which all
 * recover the cart's booking_id, from confirming it. Anything else is logged
 * and left pending.
 */
export default async function linkBookingOnOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    // `items.*`, the item read wellness-order-placed uses (SD-52: Medusa
    // 2.14.2 rewrites `items.quantity` to a property OrderLineItem lacks, and
    // `items.*` is the form known to work). `seller.id` is Mercur's
    // order→seller link (Order has no `seller_id`).
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "email", "customer_id", "metadata", "seller.id", "items.*"],
      filters: { id: data.id },
    })
    if (!order) return

    const md = await getOrderCartMetadata(container, order, ["booking_id"])
    const bookingId = md?.booking_id
    if (!bookingId || typeof bookingId !== "string") return

    const booking = container.resolve(BOOKING_MODULE) as BookingService
    const rows = await booking.listBookings({ id: bookingId }, { take: 1 })
    const row = rows?.[0]
    if (!row || row.status === BookingStatus.CANCELLED) return

    const lines = (order.items ?? []) as Array<{ product_id?: string | null } | null>
    const onOrder = lines.some((it) => it?.product_id === row.product_id)
    const productSeller = (await productSellerIds(container, [row.product_id])).get(row.product_id) ?? null
    const orderSeller = orderSellerId(order as { seller?: { id?: unknown } | null })
    if (!onOrder || productSeller !== row.seller_id || (orderSeller && orderSeller !== row.seller_id)) {
      log.warn(
        `[link-booking-on-order-placed] order ${order.id}: booking ${row.id} of seller ${row.seller_id} for product ` +
          `${row.product_id} not confirmed (product on order: ${onOrder}, product's seller: ${productSeller ?? "none"}, ` +
          `order's seller: ${orderSeller ?? "none"})`
      )
      return
    }

    await booking.updateBookings({
      id: row.id,
      order_id: order.id,
      customer_id: order.customer_id ?? row.customer_id ?? null,
      status: BookingStatus.CONFIRMED,
    })

    let vendorName: string | null = null
    try {
      const { data: sellers } = await query.graph({
        entity: "seller",
        fields: ["name"],
        filters: { id: row.seller_id } as any,
      })
      vendorName = sellers?.[0]?.name ?? null
    } catch {
      /* non-fatal */
    }

    await notifyBookingConfirmed(
      container,
      { ...row, status: BookingStatus.CONFIRMED },
      vendorName
    )
  } catch (error) {
    log.error(`[link-booking-on-order-placed] failed for ${data.id}:`, error)
    // Never throw — must not break order processing.
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
