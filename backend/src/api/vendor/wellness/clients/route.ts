import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../_helpers"

const log = createLogger("api/vendor/wellness/clients")

// GET /vendor/wellness/clients?q=&tag=
// SCOPED: only ever returns the authenticated seller's client profiles.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const filters: Record<string, unknown> = { seller_id: seller }
    const q = String(req.query.q || "").trim()
    if (q) filters.email = { $ilike: `%${q}%` }
    const rows = await wellnessService(req).listClientProfiles(filters, {
      order: { last_seen_at: "DESC" },
    })
    return res.json({ clients: rows })
  } catch (e) {
    return fail(res, log, "GET /vendor/wellness/clients", e)
  }
}

// POST upsert a client profile.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{ email: string; name?: string; phone?: string; customer_id?: string }>(req)
    if (!b.email) return res.status(400).json({ message: "email is required" })
    const profile = await wellnessService(req).upsertClientProfile(seller, b)
    return res.status(201).json({ client: profile })
  } catch (e) {
    return fail(res, log, "POST /vendor/wellness/clients", e)
  }
}
