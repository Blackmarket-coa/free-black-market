import { createLogger } from "../shared/logger"
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { BOOKING_MODULE } from "../modules/booking"
import { BookingStatus } from "../modules/booking/models/booking"
import type BookingService from "../modules/booking/service"
import { notifyBookingConfirmed } from "../shared/booking-notify"

const log = createLogger("subscribers/link-booking-on-order-placed")

/**
 * Best-effort: when an order carries a `booking_id` in its metadata (set by the
 * embed checkout deep link), link the order to the booking, attach the customer,
 * confirm it, and email the customer. No-ops for ordinary orders.
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

    const bookingId = (order.metadata as Record<string, unknown> | null)?.booking_id
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
