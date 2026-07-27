import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  PredictionMode,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../modules/vendor-hype-operations-prediction/service"

const createMarketSchema = z.object({
  profile_id: z.string(),
  milestone_id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  mode: z.nativeEnum(PredictionMode).optional(),
  jurisdiction_code: z.string().min(2),
  policy_version: z.string().optional(),
  oracle_config_id: z.string().min(1),
  starts_at: z.string().datetime(),
  locks_at: z.string().datetime(),
  settlement_deadline_at: z.string().datetime().optional(),
  payout_cap_config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const markets = await service.listPredictionMarkets({})
  res.json({ markets })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  // The route now requires an authenticated account (see the community-write
  // matchers in src/api/middlewares.ts). Fail closed rather than silently
  // attributing an unauthenticated create to "system".
  const actorId = (req as any).auth_context?.actor_id
  if (!actorId) {
    return res
      .status(401)
      .json({ message: "Authentication required", type: "unauthorized" })
  }
  const body = createMarketSchema.parse(req.body)

  const market = await service.createPredictionMarket({
    ...body,
    policy_version: body.policy_version,
    starts_at: new Date(body.starts_at),
    locks_at: new Date(body.locks_at),
    settlement_deadline_at: body.settlement_deadline_at
      ? new Date(body.settlement_deadline_at)
      : undefined,
    created_by: actorId,
  })

  res.status(201).json({ market })
}
