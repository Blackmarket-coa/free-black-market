import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"
import { sellerId, fail } from "../_helpers"

const log = createLogger("api/vendor/wellness/bookings")

// GET /vendor/wellness/bookings?status=&from=&to=
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const filters: Record<string, unknown> = { seller_id: seller }
    if (req.query.status) filters.status = String(req.query.status)
    if (req.query.from || req.query.to) {
      const range: Record<string, Date> = {}
      if (req.query.from) range.$gte = new Date(String(req.query.from))
      if (req.query.to) range.$lt = new Date(String(req.query.to))
      filters.starts_at = range
    }
    const bookings = await booking.listBookings(filters as never, {
      order: { starts_at: "ASC" },
    })
    return res.json({ bookings })
  } catch (e) {
    return fail(res, log, "GET bookings", e)
  }
}
