import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../_helpers"

const log = createLogger("api/vendor/wellness/members")

// GET /vendor/wellness/members?tier=&status=
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const filters: Record<string, unknown> = { seller_id: seller }
    if (req.query.tier) filters.membership_tier_id = String(req.query.tier)
    if (req.query.status) filters.status = String(req.query.status)
    const rows = await wellnessService(req).listMembers(filters, {
      order: { created_at: "DESC" },
    })
    return res.json({ members: rows })
  } catch (e) {
    return fail(res, log, "GET members", e)
  }
}

// POST manually add a member.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      membership_tier_id: string
      email: string
      name?: string
      customer_id?: string
      subscription_id?: string
    }>(req)
    if (!b.membership_tier_id || !b.email)
      return res.status(400).json({ message: "membership_tier_id and email are required" })
    const created = await wellnessService(req).createMembers({
      seller_id: seller,
      membership_tier_id: b.membership_tier_id,
      email: b.email,
      name: b.name ?? null,
      customer_id: b.customer_id ?? null,
      subscription_id: b.subscription_id ?? null,
      status: "active",
      joined_at: new Date(),
    })
    return res.status(201).json({ member: created })
  } catch (e) {
    return fail(res, log, "POST members", e)
  }
}
