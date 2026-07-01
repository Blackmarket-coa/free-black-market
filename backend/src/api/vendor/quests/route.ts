import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../modules/vendor-quest/service"

/**
 * GET /vendor/quests
 *
 * The quest catalog: every available quest, what it needs (tagged
 * requirements), its stages, gatekeeper, and disclaimer — so a vendor can see
 * what a quest requires BEFORE opting in. Pure config; no vendor data.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const quests = service.getCatalog()
  res.json({ quests, count: quests.length })
}
