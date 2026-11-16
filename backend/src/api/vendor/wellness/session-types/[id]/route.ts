import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body, ownedProductId, pickFields } from "../../_helpers"
import { forbidden } from "../../../../../shared/community-read-access"

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

/**
 * What a vendor may change on a session type: the fields the create takes,
 * plus `is_active`. Not `seller_id`, `metadata` or the timestamps. The update
 * used to spread the whole body into the row, `product_id` included and
 * unchecked (SD-81 addendum).
 */
const SESSION_TYPE_UPDATE_FIELDS = [
  "name",
  "description",
  "duration_minutes",
  "buffer_minutes",
  "price_amount",
  "currency_code",
  "color",
  "location_type",
  "intake_form_id",
  "prep_instructions",
  "max_per_week",
  "product_id",
  "is_embeddable",
  "is_active",
] as const

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const patch: Record<string, unknown> = pickFields(body<Record<string, unknown>>(req), SESSION_TYPE_UPDATE_FIELDS)
    // The linked product must be the caller's own (403 otherwise).
    if (patch.product_id !== undefined) {
      const product = await ownedProductId(req, seller, patch.product_id)
      if (!product.ok) return forbidden(res)
      patch.product_id = product.value
    }
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
