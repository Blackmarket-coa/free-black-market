import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../../../modules/vendor-quest/service"
import { getSellerId } from "../../../_helpers"

/**
 * POST /vendor/quests/collective/:id/join
 *
 * Join a collective as a member (enrolls the caller in the collective's quest,
 * tagged with the collective id). Joining does NOT grant data access — the
 * member must separately record scoped consent before their record is
 * aggregated.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const collective = await service.retrieveQuestCollective(req.params.id)

  const enrollment = await service.enroll(sellerId, collective.quest_key, collective.id)
  res.status(201).json({ enrollment })
}
