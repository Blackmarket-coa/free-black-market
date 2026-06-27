import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/session-types/[id]")

async function ownedRow(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listSessionTypes(
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
    return res.json({ session_type: row })
  } catch (e) {
    return fail(res, log, "GET session-type", e)
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
    const updated = await wellnessService(req).updateSessionTypes({
      id: req.params.id,
      ...patch,
    })
    return res.json({ session_type: updated })
  } catch (e) {
    return fail(res, log, "POST session-type update", e)
  }
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    await wellnessService(req).deleteSessionTypes(req.params.id)
    return res.json({ id: req.params.id, deleted: true })
  } catch (e) {
    return fail(res, log, "DELETE session-type", e)
  }
}
