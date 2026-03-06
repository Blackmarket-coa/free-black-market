import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SafetyRiskLevel, VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../modules/vendor-hype-operations-prediction/service"

const schema = z.object({
  supporter_id: z.string().min(1),
  self_excluded_until: z.string().datetime().optional().nullable(),
  cooldown_until: z.string().datetime().optional().nullable(),
  daily_position_limit: z.number().int().positive().optional(),
  risk_level: z.nativeEnum(SafetyRiskLevel).optional(),
  metadata: z.record(z.unknown()).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const actorType = (req as any).auth_context?.actor_type
  if (actorType && actorType !== "admin") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const body = schema.parse(req.body)
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const safety = await service.upsertUserPredictionSafety({
    ...body,
    self_excluded_until: body.self_excluded_until ? new Date(body.self_excluded_until) : null,
    cooldown_until: body.cooldown_until ? new Date(body.cooldown_until) : null,
  })

  res.json({ safety })
}
