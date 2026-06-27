import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { WellnessAutomationService } from "../../../../../modules/wellness/automation-service"
import { sellerId, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/automations/test")

// POST /vendor/wellness/automations/test — send a test DM for a trigger.
// Body: { trigger, recipient_email, recipient_name?, vars? }
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      trigger: string
      recipient_email: string
      recipient_name?: string
      vars?: Record<string, string>
    }>(req)
    if (!b.trigger || !b.recipient_email)
      return res.status(400).json({ message: "trigger and recipient_email are required" })

    const automation = new WellnessAutomationService(req.scope)
    const result = await automation.runTrigger({
      seller_id: seller,
      trigger: b.trigger,
      vars: b.vars ?? { name: b.recipient_name ?? "there" },
      recipients: [{ email: b.recipient_email, name: b.recipient_name ?? null }],
    })
    return res.json({ result })
  } catch (e) {
    return fail(res, log, "POST automations/test", e)
  }
}
