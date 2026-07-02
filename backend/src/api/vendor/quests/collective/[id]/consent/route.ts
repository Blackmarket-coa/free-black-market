import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../../../modules/vendor-quest/service"
import { getSellerId } from "../../../_helpers"

/**
 * POST /vendor/quests/collective/:id/consent  { scopes: string[] }
 *
 * A member records explicit, scoped consent to aggregate their substrate. A
 * seller can only consent for THEMSELVES (scoped by the authenticated seller id).
 */
export const POST = async (
  req: MedusaRequest<{ scopes: string[] }>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const scopes = req.body?.scopes
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ message: "scopes[] is required" })
  }

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const collective = await service.retrieveQuestCollective(req.params.id)

  // Must be an enrolled member of this collective to consent.
  const members = await service.listCollectiveMembers(collective.id)
  if (!members.some((m) => m.seller_id === sellerId)) {
    return res.status(403).json({ message: "Join the collective before consenting" })
  }

  const consent = await service.recordConsent(collective.id, sellerId, scopes)
  res.status(201).json({ consent })
}

/**
 * DELETE /vendor/quests/collective/:id/consent
 *
 * Revoke the caller's consent. Their own records are untouched; they are simply
 * excluded from future aggregation.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const consents = await service.listQuestMemberConsents({
    collective_id: req.params.id,
    seller_id: sellerId,
  })
  let revoked = 0
  for (const c of consents) {
    if (!c.revoked_at) {
      await service.revokeConsent(c.id)
      revoked++
    }
  }
  res.json({ revoked })
}
