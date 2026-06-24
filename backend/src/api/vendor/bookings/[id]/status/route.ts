import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { requireSellerId } from "../../../../../shared"
import { BOOKING_MODULE } from "../../../../../modules/booking"
import { BookingStatus } from "../../../../../modules/booking/models/booking"
import type BookingService from "../../../../../modules/booking/service"
import { notifyBookingConfirmed } from "../../../../../shared/booking-notify"

const log = createLogger("api/vendor/bookings/[id]/status")

const ALLOWED = new Set<string>(Object.values(BookingStatus))

/**
 * PATCH /vendor/bookings/:id/status  { status }
 *
 * Transitions a booking. Confirming sends the customer a confirmation email
 * (best-effort). Scoped to the owning seller.
 */
export async function PATCH(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const status = String((req.body as { status?: string })?.status || "")
  if (!ALLOWED.has(status)) {
    return res.status(400).json({
      message: `status must be one of: ${[...ALLOWED].join(", ")}`,
      type: "invalid_data",
    })
  }

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const rows = await booking.listBookings(
      { id: req.params.id, seller_id: sellerId },
      { take: 1 }
    )
    const row = rows?.[0]
    if (!row) {
      return res
        .status(404)
        .json({ message: "Booking not found", type: "not_found" })
    }

    await booking.updateBookings({ id: row.id, status: status as BookingStatus })

    if (status === BookingStatus.CONFIRMED && row.status !== BookingStatus.CONFIRMED) {
      let vendorName: string | null = null
      try {
        const query = req.scope.resolve("query")
        const { data: sellers } = await query.graph({
          entity: "seller",
          fields: ["name"],
          filters: { id: sellerId },
        })
        vendorName = sellers?.[0]?.name ?? null
      } catch {
        /* non-fatal */
      }
      await notifyBookingConfirmed(req.scope, { ...row, status }, vendorName)
    }

    return res.json({ booking: { ...row, status } })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[PATCH /vendor/bookings/:id/status] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to update booking", type: "server_error" })
  }
}
