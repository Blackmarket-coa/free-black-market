import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  HypeProfileType,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../modules/vendor-hype-operations-prediction/service"

const createSchema = z.object({
  profile_type: z.nativeEnum(HypeProfileType),
  owner_id: z.string().min(1),
  slug: z.string().min(3),
  display_name: z.string().min(1),
  mission: z.string().min(1),
  story_markdown: z.string().optional(),
  trust_score: z.number().optional(),
  readiness_score: z.number().optional(),
  capital_need_amount: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const ensureAdminActor = (req: MedusaRequest, res: MedusaResponse) => {
  const actorType = (req as any).auth_context?.actor_type
  if (actorType && actorType !== "user" && actorType !== "admin") {
    res.status(403).json({ error: "Forbidden" })
    return false
  }
  return true
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!ensureAdminActor(req, res)) {
    return
  }

  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )
  const profiles = await service.listHypeProfiles({})
  res.json({ profiles })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!ensureAdminActor(req, res)) {
    return
  }

  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const body = createSchema.parse(req.body)
  const profile = await service.createHypeProfile(body)
  res.status(201).json({ profile })
}
