import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../_helpers"

const log = createLogger("api/vendor/wellness/automations")

// GET — lists templates, seeding the disabled defaults on first read.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const svc = wellnessService(req)
    await svc.seedDefaultAutomationTemplates(seller)
    const rows = await svc.listAutomationTemplates(
      { seller_id: seller },
      { order: { trigger: "ASC" } }
    )
    return res.json({ automations: rows })
  } catch (e) {
    return fail(res, log, "GET automations", e)
  }
}

// POST upsert a template by trigger.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      trigger: string
      name?: string
      body?: string
      channel?: string
      enabled?: boolean
      offset_minutes?: number
    }>(req)
    if (!b.trigger) return res.status(400).json({ message: "trigger is required" })
    const svc = wellnessService(req)
    const existing = (await svc.listAutomationTemplates(
      { seller_id: seller, trigger: b.trigger },
      { take: 1 }
    )) as Array<{ id: string }>
    if (existing?.[0]) {
      const updated = await svc.updateAutomationTemplates({
        id: existing[0].id,
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.body !== undefined ? { body: b.body } : {}),
        ...(b.channel !== undefined ? { channel: b.channel } : {}),
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        ...(b.offset_minutes !== undefined ? { offset_minutes: b.offset_minutes } : {}),
      })
      return res.json({ automation: updated })
    }
    const created = await svc.createAutomationTemplates({
      seller_id: seller,
      trigger: b.trigger,
      name: b.name ?? b.trigger,
      body: b.body ?? "",
      channel: b.channel ?? "matrix",
      enabled: b.enabled ?? false,
      offset_minutes: b.offset_minutes ?? null,
    })
    return res.status(201).json({ automation: created })
  } catch (e) {
    return fail(res, log, "POST automations", e)
  }
}
