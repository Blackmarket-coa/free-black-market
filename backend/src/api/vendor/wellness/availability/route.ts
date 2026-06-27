import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"
import { sellerId, fail, body } from "../_helpers"

const log = createLogger("api/vendor/wellness/availability")

// GET — the practitioner's weekly availability windows (from the booking module).
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const windows = await booking.listVendorAvailabilities(
      { seller_id: seller },
      { order: { day_of_week: "ASC" } }
    )
    return res.json({ availability: windows })
  } catch (e) {
    return fail(res, log, "GET availability", e)
  }
}

// POST — replace the weekly availability template.
// Body: { windows: [{ day_of_week, start_time, end_time }] }
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      windows: Array<{ day_of_week: number; start_time: string; end_time: string }>
    }>(req)
    if (!Array.isArray(b.windows))
      return res.status(400).json({ message: "windows array is required" })

    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const existing = (await booking.listVendorAvailabilities({
      seller_id: seller,
    })) as Array<{ id: string }>
    if (existing.length) {
      await booking.deleteVendorAvailabilities(existing.map((w) => w.id))
    }
    const created = await booking.createVendorAvailabilities(
      b.windows.map((w) => ({
        seller_id: seller,
        day_of_week: w.day_of_week,
        start_time: w.start_time,
        end_time: w.end_time,
        is_active: true,
      }))
    )
    return res.json({ availability: created })
  } catch (e) {
    return fail(res, log, "POST availability", e)
  }
}
