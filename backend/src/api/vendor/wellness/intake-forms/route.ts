import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../_helpers"

const log = createLogger("api/vendor/wellness/intake-forms")

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const rows = await wellnessService(req).listIntakeForms(
      { seller_id: seller },
      { order: { created_at: "DESC" } }
    )
    return res.json({ intake_forms: rows })
  } catch (e) {
    return fail(res, log, "GET intake-forms", e)
  }
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{ title: string; description?: string; fields?: unknown[] }>(req)
    if (!b.title) return res.status(400).json({ message: "title is required" })
    const created = await wellnessService(req).createIntakeForms({
      seller_id: seller,
      title: b.title.trim(),
      description: b.description ?? null,
      fields: (b.fields ?? []) as unknown as Record<string, unknown>,
    })
    return res.status(201).json({ intake_form: created })
  } catch (e) {
    return fail(res, log, "POST intake-forms", e)
  }
}
