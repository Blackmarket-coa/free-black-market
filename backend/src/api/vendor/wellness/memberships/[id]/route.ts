import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/memberships/[id]")

async function ownedRow(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listMembershipTiers(
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
    return res.json({ membership_tier: row })
  } catch (e) {
    return fail(res, log, "GET membership tier", e)
  }
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const patch = body<Record<string, unknown>>(req)
    delete patch.id
    delete patch.seller_id
    const updated = await wellnessService(req).updateMembershipTiers({
      id: req.params.id,
      ...patch,
    })
    return res.json({ membership_tier: updated })
  } catch (e) {
    return fail(res, log, "POST membership tier update", e)
  }
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const updated = await wellnessService(req).updateMembershipTiers({
      id: req.params.id,
      is_active: false,
    })
    return res.json({ membership_tier: updated, archived: true })
  } catch (e) {
    return fail(res, log, "DELETE membership tier", e)
  }
}
