import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CampaignStatus,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../../modules/collective-campaign/service"

const patchSchema = z.object({
  action: z.enum(["activate", "transition", "release-maker-fee", "mark-failed"]),
  status: z.nativeEnum(CampaignStatus).optional(),
  milestone: z.enum(["MATERIALS_RECEIVED", "FULFILLMENT"]).optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
  const dashboard = await service.getCampaignDashboard(req.params.id)
  return res.json({ campaign_dashboard: dashboard })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
  const body = patchSchema.parse(req.body)

  if (body.action === "activate") {
    const updated = await service.transitionCampaignStatus(req.params.id, CampaignStatus.ACTIVE)
    return res.json({ campaign: updated })
  }

  if (body.action === "transition") {
    if (!body.status) {
      return res.status(400).json({ error: "status is required for transition action" })
    }
    const updated = await service.transitionCampaignStatus(req.params.id, body.status)
    return res.json({ campaign: updated })
  }

  if (body.action === "release-maker-fee") {
    if (!body.milestone) {
      return res.status(400).json({ error: "milestone is required for release-maker-fee action" })
    }
    const release = await service.releaseMakerFeeByMilestone(req.params.id, body.milestone)
    return res.json({ release })
  }

  const result = await service.markCampaignFailed(req.params.id)
  return res.json(result)
}
