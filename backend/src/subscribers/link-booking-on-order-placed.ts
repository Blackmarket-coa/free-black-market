import { createLogger } from "../shared/logger"
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { BOOKING_MODULE } from "../modules/booking"
import { BookingStatus } from "../modules/booking/models/booking"
import type BookingService from "../modules/booking/service"
import { notifyBookingConfirmed } from "../shared/booking-notify"
import { getOrderCartMetadata } from "../lib/cart-metadata-recovery"

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
 */
export default async function linkBookingOnOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const query = container.resolve("query")
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "email", "customer_id", "metadata"],
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
