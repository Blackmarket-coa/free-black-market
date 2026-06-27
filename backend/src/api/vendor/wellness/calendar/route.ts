import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"
import { sellerId, wellnessService, fail } from "../_helpers"

const log = createLogger("api/vendor/wellness/calendar")

// GET /vendor/wellness/calendar?from=ISO&to=ISO
// Unified view of 1:1 bookings + group classes in the window.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date()
    const to = req.query.to
      ? new Date(String(req.query.to))
      : new Date(from.getTime() + 7 * 86_400_000)

    const svc = wellnessService(req)
    let bookings: unknown[] = []
    try {
      const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
      bookings = (await booking.listBookings(
        { seller_id: seller, starts_at: { $gte: from, $lt: to } } as never,
        { order: { starts_at: "ASC" } }
      )) as unknown[]
    } catch (e) {
      log.warn("calendar: bookings failed", e)
    }

    const classes = (await svc.listClassEvents(
      { seller_id: seller, starts_at: { $gte: from, $lt: to } } as never,
      { order: { starts_at: "ASC" } }
    )) as unknown[]

    return res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      bookings,
      classes,
    })
  } catch (e) {
    return fail(res, log, "GET calendar", e)
  }
}
