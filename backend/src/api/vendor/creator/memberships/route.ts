import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { listCreatorMembershipTiers } from "../../../../lib/creator-hub"

/**
 * GET /vendor/creator/memberships
 * The creator's membership tiers, grouped from their subscriptions. Counts and
 * Blackout-tier mapping are real; price/perks await a dedicated tier config.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const membership_tiers = await listCreatorMembershipTiers(req.scope, sellerId)
  return res.json({ membership_tiers, count: membership_tiers.length })
}
