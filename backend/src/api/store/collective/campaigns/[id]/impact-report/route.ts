import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../../../modules/collective-campaign"
import type CollectiveCampaignModuleService from "../../../../../../modules/collective-campaign/service"
import { getErrorMessage } from "../_shared-goal-host"

/**
 * GET /store/collective/campaigns/:id/impact-report — public joint impact
 * report: reached milestones, per-org totals, yield reports and the host's
 * impact summary. Computed from the same rows as /progress.
 * Gated by FF_SHARED_GOAL_COALITION_V1 in middlewares.ts (404 when off).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    const report = await service.getJointImpactReport(req.params.id)
    return res.json({ impact_report: report })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    return res.status(message.toLowerCase().includes("not found") ? 404 : 500).json({ error: message })
  }
}
