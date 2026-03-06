import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../modules/vendor-hype-operations-prediction/service"

const updateSchema = z.object({
  display_name: z.string().min(1).optional(),
  mission: z.string().min(1).optional(),
  story_markdown: z.string().optional(),
  trust_score: z.number().optional(),
  readiness_score: z.number().optional(),
  capital_need_amount: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const [profile] = await service.listHypeProfiles({ id: req.params.id })
  if (!profile) {
    return res.status(404).json({ error: "Profile not found" })
  }

  res.json({ profile })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const body = updateSchema.parse(req.body)
  const profile = await service.updateHypeProfile(req.params.id, body)
  res.json({ profile })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  await service.deleteHypeProfile(req.params.id)
  res.status(200).json({ id: req.params.id, object: "hype_profile", deleted: true })
}
