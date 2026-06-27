import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../../../_helpers"

const log = createLogger("api/vendor/wellness/classes/[id]/attendees/[aid]")

// POST update attendance status (attended | no_show | cancelled).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const rows = (await wellnessService(req).listClassAttendees(
      { id: req.params.aid, seller_id: seller, class_event_id: req.params.id },
      { take: 1 }
    )) as Array<{ id: string }>
    if (!rows?.[0]) return res.status(404).json({ message: "Not found" })

    const b = body<{ status: string }>(req)
    if (!b.status) return res.status(400).json({ message: "status is required" })
    const updated = await wellnessService(req).markClassAttendance(req.params.aid, b.status)
    return res.json({ attendee: updated })
  } catch (e) {
    return fail(res, log, "POST attendance", e)
  }
}
