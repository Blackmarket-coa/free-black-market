import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../../../../modules/vendor-hype-operations-prediction/service"

const reverseSchema = z.object({
  reason: z.string().min(3),
  execution_run_id: z.string().optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const actorType = (req as any).auth_context?.actor_type
  if (actorType && actorType !== "admin") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )
  const body = reverseSchema.parse(req.body)

  const settlement = await service.reverseSettlement({
    settlement_id: req.params.settlementId,
    market_id: req.params.id,
    reason: body.reason,
    execution_run_id: body.execution_run_id || `reverse_${Date.now()}`,
    actor_id: (req as any).auth_context?.actor_id || "operator",
  })

  res.json({ settlement })
}
