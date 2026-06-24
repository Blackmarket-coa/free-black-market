import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { BOOKING_MODULE } from "../../../modules/booking"
import type BookingService from "../../../modules/booking/service"

const log = createLogger("api/vendor/bookings")

/**
 * GET /vendor/bookings?status=&limit=&offset=
 *
 * Lists this vendor's bookings, newest first. Optional `status` filter.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const status = req.query.status ? String(req.query.status) : undefined
    const take = Math.min(Number(req.query.limit) || 50, 200)
    const skip = Number(req.query.offset) || 0

    const filters: Record<string, unknown> = { seller_id: sellerId }
    if (status) filters.status = status

    const [rows, count] = await booking.listAndCountBookings(filters, {
      order: { starts_at: "DESC" },
      take,
      skip,
    })

    return res.json({ bookings: rows, count, limit: take, offset: skip })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/bookings] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to load bookings", type: "server_error" })
  }
}
