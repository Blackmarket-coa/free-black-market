import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { PROGRESSION_MODULE } from "../../../../modules/progression"
import type ProgressionModuleService from "../../../../modules/progression/service"
import {
  resolveCreatorOwnerCustomerId,
  type CreatorQueryLike,
} from "../../../../lib/creator-hub"

/**
 * GET /vendor/creator/xp-balances  (always-on, read-only)
 *
 * The authenticated creator's spendable XP, surfaced as the single aggregate
 * entry the portal's `useXpBalances` renders. XP is progression's
 * `character_sheet.spendable_xp`, resolved through the seller's owner member.
 * Returned as `{ balances: XpBalance[] }` — a lone "All spaces" bucket, because
 * FBM progression is per-customer, not per-Blackout-Space.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const query = req.scope.resolve<CreatorQueryLike>(ContainerRegistrationKeys.QUERY)
  const customerId = await resolveCreatorOwnerCustomerId(query, sellerId)

  const progression = req.scope.resolve<ProgressionModuleService>(PROGRESSION_MODULE)
  const xp = customerId ? await progression.getSpendableXp(customerId) : 0

  return res.json({
    balances: [{ space_id: "all", space_name: "All spaces", xp }],
  })
}
