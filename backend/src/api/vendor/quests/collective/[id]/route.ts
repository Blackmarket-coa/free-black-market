import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../../modules/vendor-quest/service"
import { getSellerId } from "../../_helpers"
import { evaluateCollectiveFromConsent } from "../_helpers"

/**
 * GET /vendor/quests/collective/:id
 *
 * Collective detail + aggregate evaluation over ONLY consenting members. Access
 * is limited to the owner and enrolled members (never leak to outsiders).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const collective = await service.retrieveQuestCollective(req.params.id)

  const members = await service.listCollectiveMembers(collective.id)
  const isMember = members.some((m) => m.seller_id === sellerId)
  const isOwner = collective.owner_seller_id === sellerId
  if (!isOwner && !isMember) {
    return res.status(404).json({ message: "Not found" })
  }

  const agg = await evaluateCollectiveFromConsent(req, collective)

  res.json({
    collective,
    is_owner: isOwner,
    // Only expose member ids + consent state, never other members' substrates.
    member_count: members.length,
    consented_member_ids: agg.consented_member_ids,
    required_scopes: agg.required_scopes,
    evaluation: agg.evaluation,
  })
}
