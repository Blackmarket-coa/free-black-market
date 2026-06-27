import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../../_helpers"

const log = createLogger("api/vendor/wellness/members/[id]/credits")

// POST adjust credits: { action: "allocate" | "consume", amount? }
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const rows = (await wellnessService(req).listMembers(
      { id: req.params.id, seller_id: seller },
      { take: 1 }
    )) as Array<{ id: string }>
    if (!rows?.[0]) return res.status(404).json({ message: "Not found" })

    const b = body<{ action: "allocate" | "consume"; amount?: number }>(req)
    const svc = wellnessService(req)
    if (b.action === "allocate") {
      const member = await svc.allocateCreditsForPeriod(req.params.id)
      return res.json({ member })
    }
    if (b.action === "consume") {
      const ok = await svc.consumeCredit(req.params.id, b.amount ?? 1)
      if (!ok) return res.status(409).json({ message: "Insufficient credits" })
      const member = await svc.retrieveMember(req.params.id)
      return res.json({ member })
    }
    return res.status(400).json({ message: "action must be allocate or consume" })
  } catch (e) {
    return fail(res, log, "POST member credits", e)
  }
}
