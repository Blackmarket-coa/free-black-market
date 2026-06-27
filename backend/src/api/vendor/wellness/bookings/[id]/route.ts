import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../../modules/booking"
import type BookingService from "../../../../../modules/booking/service"
import { sellerId, wellnessService, fail } from "../../_helpers"

const log = createLogger("api/vendor/wellness/bookings/[id]")

// GET booking detail + any intake responses for it. SCOPED to the seller.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const rows = (await booking.listBookings(
      { id: req.params.id, seller_id: seller } as never,
      { take: 1 }
    )) as Array<{ id: string }>
    if (!rows?.[0]) return res.status(404).json({ message: "Not found" })

    const intake = await wellnessService(req).listIntakeResponses({
      seller_id: seller,
      booking_id: req.params.id,
    })
    return res.json({ booking: rows[0], intake_responses: intake })
  } catch (e) {
    return fail(res, log, "GET booking", e)
  }
}
