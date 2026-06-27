import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/clients/[id]")

async function ownedRow(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listClientProfiles(
    { id, seller_id: seller },
    { take: 1 }
  )) as Array<{ id: string }>
  return rows?.[0] ?? null
}

// GET client detail (profile + notes). SCOPED to the owning seller.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const notes = await wellnessService(req).listClientNotes(
      { client_profile_id: req.params.id, seller_id: seller },
      { order: { created_at: "DESC" } }
    )
    return res.json({ client: row, notes })
  } catch (e) {
    return fail(res, log, "GET client", e)
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
    const updated = await wellnessService(req).updateClientProfiles({
      id: req.params.id,
      ...patch,
    })
    return res.json({ client: updated })
  } catch (e) {
    return fail(res, log, "POST client update", e)
  }
}
