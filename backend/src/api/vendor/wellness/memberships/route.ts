import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../_helpers"

const log = createLogger("api/vendor/wellness/memberships")

// GET membership tiers + active counts.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const svc = wellnessService(req)
    const tiers = (await svc.listMembershipTiers(
      { seller_id: seller },
      { order: { display_order: "ASC" } }
    )) as Array<{ id: string }>
    const members = (await svc.listMembers({
      seller_id: seller,
      status: "active",
    })) as Array<{ membership_tier_id: string }>
    const counts = new Map<string, number>()
    for (const m of members)
      counts.set(m.membership_tier_id, (counts.get(m.membership_tier_id) ?? 0) + 1)
    const withCounts = tiers.map((t) => ({ ...t, active_members: counts.get(t.id) ?? 0 }))
    return res.json({ membership_tiers: withCounts })
  } catch (e) {
    return fail(res, log, "GET memberships", e)
  }
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      name: string
      description?: string
      price_amount?: number
      currency_code?: string
      interval?: string
      credits_per_period?: number
      credits_roll_over?: boolean
      discount_pct?: number
      perks?: unknown[]
      blackout_room_alias?: string
      display_order?: number
    }>(req)
    if (!b.name) return res.status(400).json({ message: "name is required" })
    const created = await wellnessService(req).createMembershipTiers({
      seller_id: seller,
      name: b.name.trim(),
      description: b.description ?? null,
      price_amount: b.price_amount ?? 0,
      currency_code: b.currency_code ?? "usd",
      interval: b.interval ?? "monthly",
      credits_per_period: b.credits_per_period ?? 0,
      credits_roll_over: b.credits_roll_over ?? false,
      discount_pct: b.discount_pct ?? 0,
      perks: (b.perks ?? null) as unknown as Record<string, unknown> | null,
      blackout_room_alias: b.blackout_room_alias ?? null,
      display_order: b.display_order ?? 0,
    })
    return res.status(201).json({ membership_tier: created })
  } catch (e) {
    return fail(res, log, "POST memberships", e)
  }
}
