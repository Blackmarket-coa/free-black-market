import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/automations/[id]")

async function ownedRow(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listAutomationTemplates(
    { id, seller_id: seller },
    { take: 1 }
  )) as Array<{ id: string }>
  return rows?.[0] ?? null
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
    delete patch.trigger
    const updated = await wellnessService(req).updateAutomationTemplates({
      id: req.params.id,
      ...patch,
    })
    return res.json({ automation: updated })
  } catch (e) {
    return fail(res, log, "POST automation update", e)
  }
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    await wellnessService(req).deleteAutomationTemplates(req.params.id)
    return res.json({ id: req.params.id, deleted: true })
  } catch (e) {
    return fail(res, log, "DELETE automation", e)
  }
}
