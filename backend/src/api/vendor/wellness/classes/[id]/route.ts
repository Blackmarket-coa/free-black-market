import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/classes/[id]")

async function ownedRow(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listClassEvents(
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
    return res.json({ class: row })
  } catch (e) {
    return fail(res, log, "GET class", e)
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
    if (patch.starts_at) patch.starts_at = new Date(patch.starts_at as string)
    if (patch.ends_at) patch.ends_at = new Date(patch.ends_at as string)
    const updated = await wellnessService(req).updateClassEvents({
      id: req.params.id,
      ...patch,
    })
    return res.json({ class: updated })
  } catch (e) {
    return fail(res, log, "POST class update", e)
  }
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    // Soft-cancel rather than hard delete so attendees/orders keep their link.
    const updated = await wellnessService(req).updateClassEvents({
      id: req.params.id,
      status: "cancelled",
    })
    return res.json({ class: updated, cancelled: true })
  } catch (e) {
    return fail(res, log, "DELETE class", e)
  }
}
