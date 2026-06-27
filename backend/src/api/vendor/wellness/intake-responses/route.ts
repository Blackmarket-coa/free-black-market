import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { sellerId, wellnessService, fail } from "../_helpers"

const log = createLogger("api/vendor/wellness/intake-responses")

// GET /vendor/wellness/intake-responses?booking_id=&client_id=&form_id=
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const filters: Record<string, unknown> = { seller_id: seller }
    if (req.query.booking_id) filters.booking_id = String(req.query.booking_id)
    if (req.query.client_id) filters.client_profile_id = String(req.query.client_id)
    if (req.query.form_id) filters.intake_form_id = String(req.query.form_id)
    const rows = await wellnessService(req).listIntakeResponses(filters, {
      order: { created_at: "DESC" },
    })
    return res.json({ intake_responses: rows })
  } catch (e) {
    return fail(res, log, "GET intake-responses", e)
  }
}
