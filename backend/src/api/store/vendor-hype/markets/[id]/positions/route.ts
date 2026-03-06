import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  PredictionStakeUnit,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../../modules/vendor-hype-operations-prediction/service"

const placePositionSchema = z.object({
  outcome_option_key: z.string().min(1),
  stake_amount: z.number().positive(),
  stake_unit: z.nativeEnum(PredictionStakeUnit).optional(),
  max_payout_amount: z.number().positive().optional(),
  idempotency_key: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const body = placePositionSchema.parse(req.body)
  const supporterId = (req as any).auth_context?.actor_id

  if (!supporterId) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const headerKey = req.headers["idempotency-key"]
  const idempotencyKey = body.idempotency_key || (Array.isArray(headerKey) ? headerKey[0] : headerKey)

  if (!idempotencyKey) {
    return res.status(400).json({ error: "idempotency_key is required in body or Idempotency-Key header" })
  }

  const position = await service.placePredictionPosition({
    market_id: req.params.id,
    supporter_id: supporterId,
    outcome_option_key: body.outcome_option_key,
    stake_amount: body.stake_amount,
    stake_unit: body.stake_unit,
    max_payout_amount: body.max_payout_amount,
    idempotency_key: idempotencyKey,
    metadata: body.metadata,
  })

  res.status(201).json({ position })
}
