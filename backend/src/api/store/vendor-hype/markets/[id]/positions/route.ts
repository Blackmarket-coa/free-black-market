import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  PredictionMode,
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
  disclosure_acknowledged: z.boolean().default(false),
  age_verified: z.boolean().default(false),
  self_excluded: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const body = placePositionSchema.parse(req.body)
  const supporterId = (req as any).auth_context?.actor_id
  const actorType = (req as any).auth_context?.actor_type

  if (!supporterId) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  if (actorType && actorType !== "customer") {
    return res.status(403).json({ error: "Only customers can place positions" })
  }

  if (!body.age_verified || body.self_excluded) {
    return res.status(403).json({ error: "Eligibility check failed" })
  }

  const [market] = await service.listPredictionMarkets({ id: req.params.id })
  if (!market) {
    return res.status(404).json({ error: "Market not found" })
  }

  if (market.mode === PredictionMode.NON_CASH && !body.disclosure_acknowledged) {
    return res.status(400).json({ error: "disclosure_acknowledged is required for non-cash mode" })
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
    metadata: {
      ...body.metadata,
      disclosure_acknowledged: body.disclosure_acknowledged,
      age_verified: body.age_verified,
    },
  })

  res.status(201).json({ position })
}
