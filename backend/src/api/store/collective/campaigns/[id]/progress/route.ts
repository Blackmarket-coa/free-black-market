import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../../../modules/collective-campaign"
import type CollectiveCampaignModuleService from "../../../../../../modules/collective-campaign/service"
import { getErrorMessage } from "../_shared-goal-host"

/**
 * GET /store/collective/campaigns/:id/progress — public shared-goal progress:
 * the campaign, its milestones and its participants with role and totals in
 * integer cents. Computed from the module's rows, never authored, and it
 * carries no donor identity (the read never touches `collective_backing`).
 * Gated by FF_SHARED_GOAL_COALITION_V1 in middlewares.ts (404 when off).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    const progress = await service.getCoalitionProgress(req.params.id)
    return res.json({ progress })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    return res.status(message.toLowerCase().includes("not found") ? 404 : 500).json({ error: message })
  }
}
