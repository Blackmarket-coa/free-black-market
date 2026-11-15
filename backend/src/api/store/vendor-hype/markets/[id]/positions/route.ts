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
  // No `age_verified` / `self_excluded` here, deliberately: both used to be
  // read from this body, so the caller attested its own eligibility. zod
  // strips unknown keys, so a client that still sends them is ignored.
  // `metadata` is free-form, so it cannot be spread onto the row as is: see
  // clientMetadata below.
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Keys that state an eligibility or consent fact about the supporter. The
 * platform decides these. The client never does, even inside free-form
 * metadata.
 */
const ELIGIBILITY_CLAIM_KEYS = new Set(["age_verified", "self_excluded", "disclosure_acknowledged"])

/**
 * The caller's free-form metadata, nested under `client_metadata` so it can
 * never sit beside the keys the server writes on the position, and with any
 * eligibility claim dropped. Spreading `body.metadata` onto the row let a
 * client store `age_verified: true` there one level down from the field the
 * schema had removed.
 */
const clientMetadata = (metadata: Record<string, unknown> | undefined) =>
  Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key]) => !ELIGIBILITY_CLAIM_KEYS.has(key))
  )

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

  const [market] = await service.listPredictionMarkets({ id: req.params.id })
  if (!market) {
    return res.status(404).json({ error: "Market not found" })
  }

  // Eligibility comes from server-side records only. Self-exclusion and
  // cooldown are enforced inside placePredictionPosition from
  // user_prediction_safety (written by operators via
  // /admin/vendor-hype/safety). The age gate has no server-side record yet, so
  // isSupporterAgeVerified fails closed and this refuses every placement until
  // one exists. See the method's comment before changing this.
  if (!(await service.isSupporterAgeVerified(supporterId, market.mode as PredictionMode))) {
    return res.status(403).json({
      type: "policy_denied",
      code: "PREDICTION_AGE_VERIFICATION_REQUIRED",
      error: "Eligibility check failed",
    })
  }

  if (market.mode === PredictionMode.NON_CASH && !body.disclosure_acknowledged) {
    return res.status(400).json({ error: "disclosure_acknowledged is required for non-cash mode" })
  }

  // A non-cash market pays "non-monetary points/rewards only"
  // (docs/VENDOR_HYPE_OPERATIONS_PREDICTION_COMPLIANCE_POLICY_MATRIX.md), so a
  // currency-denominated stake must not land on one. The schema accepts either
  // unit and the service defaults to points, so without this check a caller
  // could stake currency on the one mode whose whole compliance posture rests
  // on no money being involved. See docs/TRANSMUTATION_STRATEGY.md §5.6.
  if (
    market.mode === PredictionMode.NON_CASH &&
    body.stake_unit === PredictionStakeUnit.CURRENCY
  ) {
    return res.status(400).json({
      error: "currency stakes are not permitted on a non-cash market",
    })
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
      // The validated request field, checked above for non-cash markets.
      disclosure_acknowledged: body.disclosure_acknowledged,
      client_metadata: clientMetadata(body.metadata),
    },
  })

  res.status(201).json({ position })
}
