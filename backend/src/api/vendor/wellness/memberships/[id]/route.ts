import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { sellerId, wellnessService, fail, body, ownedProductId, pickFields } from "../../_helpers"
import { forbidden } from "../../../../../shared/community-read-access"

const log = createLogger("api/vendor/wellness/memberships/[id]")

async function ownedRow(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listMembershipTiers(
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
    return res.json({ membership_tier: row })
  } catch (e) {
    return fail(res, log, "GET membership tier", e)
  }
}

/**
 * What a vendor may change on a membership tier. Not `seller_id` or
 * `metadata`. The update used to spread the whole body into the row, which is
 * how a tier was pointed at another seller's product (SD-52 re-review).
 */
const TIER_UPDATE_FIELDS = [
  "name",
  "description",
  "price_amount",
  "currency_code",
  "interval",
  "credits_per_period",
  "credits_roll_over",
  "discount_pct",
  "perks",
  "blackout_room_alias",
  "is_active",
  "display_order",
  "product_id",
] as const

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const patch: Record<string, unknown> = pickFields(body<Record<string, unknown>>(req), TIER_UPDATE_FIELDS)
    // The tier's product must be the caller's own (403 otherwise).
    if (patch.product_id !== undefined) {
      const product = await ownedProductId(req, seller, patch.product_id)
      if (!product.ok) return forbidden(res)
      patch.product_id = product.value
    }
    const updated = await wellnessService(req).updateMembershipTiers({
      id: req.params.id,
      ...patch,
    })
    return res.json({ membership_tier: updated })
  } catch (e) {
    return fail(res, log, "POST membership tier update", e)
  }
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const row = await ownedRow(req, seller, req.params.id)
    if (!row) return res.status(404).json({ message: "Not found" })
    const updated = await wellnessService(req).updateMembershipTiers({
      id: req.params.id,
      is_active: false,
    })
    return res.json({ membership_tier: updated, archived: true })
  } catch (e) {
    return fail(res, log, "DELETE membership tier", e)
  }
}
