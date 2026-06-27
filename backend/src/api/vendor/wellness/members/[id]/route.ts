import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/members/[id]")

async function ownedRow(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listMembers(
    { id, seller_id: seller },
    { take: 1 }
  )) as Array<{ id: string }>
  return rows?.[0] ?? null
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    return res.json({ member: row })
  } catch (e) {
    return fail(res, log, "GET member", e)
  }
}

// POST update — change tier, pause, cancel, etc.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const patch = body<Record<string, unknown>>(req)
    delete patch.id
    delete patch.seller_id
    if (patch.status === "cancelled") patch.cancelled_at = new Date()
    const updated = await wellnessService(req).updateMembers({
      id: req.params.id,
      ...patch,
    })
    return res.json({ member: updated })
  } catch (e) {
    return fail(res, log, "POST member update", e)
  }
}
