import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../../_helpers"
import type { ClassRegistrationRefusal } from "../../../../../../modules/wellness/class-registration"

const log = createLogger("api/vendor/wellness/classes/[id]/attendees")

const CLASS_REFUSAL_MESSAGES: Record<ClassRegistrationRefusal, string> = {
  cancelled: "Class is cancelled",
  completed: "Class is completed",
  not_live: "Class is not open for registration",
  ended: "Class has already ended",
}

async function ownsClass(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listClassEvents(
    { id, seller_id: seller },
    { take: 1 }
  )) as Array<{ id: string }>
  return Boolean(rows?.[0])
}

// GET roster for a class.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    if (!(await ownsClass(req, seller, req.params.id)))
      return res.status(404).json({ message: "Not found" })
    const attendees = await wellnessService(req).listClassAttendees(
      { class_event_id: req.params.id, seller_id: seller },
      { order: { created_at: "ASC" } }
    )
    return res.json({ attendees })
  } catch (e) {
    return fail(res, log, "GET attendees", e)
  }
}

// POST manually add an attendee (capacity/waitlist aware).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    if (!(await ownsClass(req, seller, req.params.id)))
      return res.status(404).json({ message: "Not found" })
    const b = body<{ email: string; name?: string; customer_id?: string }>(req)
    if (!b.email) return res.status(400).json({ message: "email is required" })
    const result = await wellnessService(req).registerForClass({
      seller_id: seller,
      class_event_id: req.params.id,
      email: b.email,
      name: b.name ?? null,
      customer_id: b.customer_id ?? null,
    })
    // A cancelled, completed or finished class takes no attendee and keeps
    // its status (registerForClass refuses it).
    if (result.refused) {
      return res.status(409).json({ message: CLASS_REFUSAL_MESSAGES[result.refused], reason: result.refused })
    }
    if (result.full) return res.status(409).json({ message: "Class is full" })
    return res.status(201).json(result)
  } catch (e) {
    return fail(res, log, "POST attendee", e)
  }
}
