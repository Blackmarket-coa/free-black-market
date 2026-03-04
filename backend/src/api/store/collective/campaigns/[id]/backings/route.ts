import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  BackingMode,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../../../modules/collective-campaign/service"

const createBackingSchema = z.object({
  mode: z.nativeEnum(BackingMode),
  amount: z.number().positive(),
  units_reserved: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const backerId = (req as any).auth_context?.actor_id
    if (!backerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const body = createBackingSchema.parse(req.body)
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)

    const backing = await service.addBacking({
      campaign_id: req.params.id,
      backer_id: backerId,
      mode: body.mode,
      amount: body.amount,
      units_reserved: body.units_reserved,
      metadata: body.metadata,
    })

    return res.status(201).json({ backing })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors })
    }

    const message = getErrorMessage(error)
    return res.status(message.toLowerCase().includes("not found") ? 404 : 400).json({ error: message })
  }
}
