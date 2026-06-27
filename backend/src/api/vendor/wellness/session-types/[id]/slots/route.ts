import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../../../modules/booking"
import type BookingService from "../../../../../../modules/booking/service"
import { sellerId, wellnessService, fail } from "../../../_helpers"

const log = createLogger("api/vendor/wellness/session-types/[id]/slots")

// GET /vendor/wellness/session-types/:id/slots?date=YYYY-MM-DD
// Returns bookable slots for the linked product on the given day, via the
// existing booking slot engine.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const date = String(req.query.date || "")
    if (!date) return res.status(400).json({ message: "date is required (YYYY-MM-DD)" })

    const rows = (await wellnessService(req).listSessionTypes(
      { id: req.params.id, seller_id: seller },
      { take: 1 }
    )) as Array<{ product_id: string | null }>
    const st = rows?.[0]
    if (!st) return res.status(404).json({ message: "Not found" })
    if (!st.product_id) return res.json({ slots: [] })

    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const slots = await booking.generateSlots({
      seller_id: seller,
      product_id: st.product_id,
      date,
    })
    return res.json({ slots })
  } catch (e) {
    return fail(res, log, "GET session-type slots", e)
  }
}
