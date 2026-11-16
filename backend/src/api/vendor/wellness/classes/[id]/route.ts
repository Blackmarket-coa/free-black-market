import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body, ownedProductId, pickFields } from "../../_helpers"
import { forbidden } from "../../../../../shared/community-read-access"
import { isKnownTimeZone } from "../../../../../modules/wellness/class-messages"

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

/**
 * What a vendor may change on a class. Not `seller_id`, `seats_taken` (the
 * registration path keeps it), `matrix_room_id` (provisioned) or `metadata`
 * (holds the reminder stamp). The update used to spread the whole body into
 * the row (SD-52 re-review).
 */
const CLASS_UPDATE_FIELDS = [
  "title",
  "description",
  "starts_at",
  "ends_at",
  "timezone",
  "capacity",
  "waitlist_enabled",
  "price_amount",
  "currency_code",
  "early_bird_amount",
  "early_bird_until",
  "location_type",
  "location_detail",
  "product_id",
  "status",
  "recording_url",
  "is_embeddable",
] as const

const toDate = (v: unknown) => (v === null ? null : new Date(v as string))

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const patch: Record<string, unknown> = pickFields(body<Record<string, unknown>>(req), CLASS_UPDATE_FIELDS)
    if (patch.timezone !== undefined && !isKnownTimeZone(patch.timezone)) {
      return res.status(400).json({ message: "timezone must be an IANA time zone, e.g. America/New_York" })
    }
    // The ticket product must be the caller's own (403 otherwise).
    if (patch.product_id !== undefined) {
      const product = await ownedProductId(req, seller, patch.product_id)
      if (!product.ok) return forbidden(res)
      patch.product_id = product.value
    }
    for (const k of ["starts_at", "ends_at", "early_bird_until"] as const) {
      if (patch[k] !== undefined) patch[k] = toDate(patch[k])
    }
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
