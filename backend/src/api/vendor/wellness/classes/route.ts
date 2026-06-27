import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../_helpers"

const log = createLogger("api/vendor/wellness/classes")

// GET /vendor/wellness/classes?status=upcoming|past
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const rows = await wellnessService(req).listClassEvents(
      { seller_id: seller },
      { order: { starts_at: "DESC" } }
    )
    return res.json({ classes: rows })
  } catch (e) {
    return fail(res, log, "GET /vendor/wellness/classes", e)
  }
}

// POST /vendor/wellness/classes — create a group class/workshop.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      title: string
      description?: string
      starts_at: string
      ends_at: string
      timezone?: string
      capacity?: number
      waitlist_enabled?: boolean
      price_amount?: number
      currency_code?: string
      early_bird_amount?: number
      early_bird_until?: string
      location_type?: string
      location_detail?: string
      product_id?: string
      is_embeddable?: boolean
    }>(req)

    if (!b.title || !b.starts_at || !b.ends_at) {
      return res.status(400).json({ message: "title, starts_at, ends_at are required" })
    }

    const created = await wellnessService(req).createClassEvents({
      seller_id: seller,
      title: b.title.trim(),
      description: b.description ?? null,
      starts_at: new Date(b.starts_at),
      ends_at: new Date(b.ends_at),
      timezone: b.timezone ?? "America/New_York",
      capacity: b.capacity ?? 0,
      seats_taken: 0,
      waitlist_enabled: b.waitlist_enabled ?? false,
      price_amount: b.price_amount ?? null,
      currency_code: b.currency_code ?? null,
      early_bird_amount: b.early_bird_amount ?? null,
      early_bird_until: b.early_bird_until ? new Date(b.early_bird_until) : null,
      location_type: b.location_type ?? "video",
      location_detail: b.location_detail ?? null,
      product_id: b.product_id ?? null,
      status: "scheduled",
      is_embeddable: b.is_embeddable ?? true,
    })
    return res.status(201).json({ class: created })
  } catch (e) {
    return fail(res, log, "POST /vendor/wellness/classes", e)
  }
}
