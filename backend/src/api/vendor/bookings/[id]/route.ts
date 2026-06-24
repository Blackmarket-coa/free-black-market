import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"

const log = createLogger("api/vendor/bookings/[id]")

/**
 * GET /vendor/bookings/:id — single booking, scoped to the owning seller.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

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
    return res.json({ booking: row })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/bookings/:id] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to load booking", type: "server_error" })
  }
}
