import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  isPredictionPolicyRefusal,
  PredictionMarketState,
  PredictionMode,
  predictionPolicyDeniedResponse,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../modules/vendor-hype-operations-prediction/service"
import {
  actorId as resolveActorId,
  actorIsAnyOf,
  forbidden,
} from "../../../../shared/community-read-access"

const createMarketSchema = z.object({
  profile_id: z.string(),
  milestone_id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  mode: z.nativeEnum(PredictionMode).optional(),
  jurisdiction_code: z.string().min(2),
  // No `policy_version`: the policy that admits the market records its own
  // (createPredictionMarket). zod strips unknown keys, so a client that still
  // sends one is ignored, as it already was in effect.
  oracle_config_id: z.string().min(1),
  starts_at: z.string().datetime(),
  locks_at: z.string().datetime(),
  settlement_deadline_at: z.string().datetime().optional(),
  payout_cap_config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * States the public listing shows. A DRAFT is the owner's unpublished work:
 * per the architecture (§4.2) a market is created in draft and needs operator
 * approval to publish, so listing drafts here would publish them the moment
 * they were created. This is an allow-list, so a state added later stays
 * private until someone adds it here.
 */
const PUBLIC_MARKET_STATES: PredictionMarketState[] = [
  PredictionMarketState.SCHEDULED,
  PredictionMarketState.OPEN,
  PredictionMarketState.LOCKED,
  PredictionMarketState.IN_REVIEW,
  PredictionMarketState.SETTLED,
  PredictionMarketState.VOIDED,
]

type MarketRow = Awaited<
  ReturnType<VendorHypeOperationsPredictionService["listPredictionMarkets"]>
>[number]

/**
 * The fields an anonymous reader gets. `created_by` is left out: it holds the
 * creating account's actor id (a customer or member id), which is not public.
 * Also an allow-list, so a new column is not published by default.
 */
const toPublicMarket = (market: MarketRow) => ({
  id: market.id,
  profile_id: market.profile_id,
  milestone_id: market.milestone_id,
  title: market.title,
  description: market.description,
  mode: market.mode,
  jurisdiction_code: market.jurisdiction_code,
  policy_version: market.policy_version,
  oracle_config_id: market.oracle_config_id,
  starts_at: market.starts_at,
  locks_at: market.locks_at,
  settlement_deadline_at: market.settlement_deadline_at,
  payout_cap_config: market.payout_cap_config,
  state: market.state,
  metadata: market.metadata,
  created_at: market.created_at,
  updated_at: market.updated_at,
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const markets = await service.listPredictionMarkets({ state: PUBLIC_MARKET_STATES })
  res.json({ markets: markets.map(toPublicMarket) })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  // The route now requires an authenticated account (see the community-write
  // matchers in src/api/middlewares.ts). Fail closed rather than silently
  // attributing an unauthenticated create to "system".
  const actorId = resolveActorId(req)
  if (!actorId) {
    return res
      .status(401)
      .json({ message: "Authentication required", type: "unauthorized" })
  }
  const body = createMarketSchema.parse(req.body)

  // Being signed in is not enough: a market is created under a hype profile,
  // and only that profile's owner may do it
  // (docs/VENDOR_HYPE_OPERATIONS_PREDICTION_BACKEND_ARCHITECTURE.md §4.2).
  // The market is always created in DRAFT, and moving it on is an operator
  // action at POST /admin/vendor-hype/markets/:id/state. A missing profile and
  // someone else's profile get the same 403, so profile ids cannot be probed.
  const [profile] = await service.listHypeProfiles({ id: body.profile_id })
  if (!profile || !actorIsAnyOf(req, profile.owner_id)) {
    return forbidden(res)
  }

  // A mode the jurisdiction's profile does not allow is refused 403
  // `policy_denied` / PREDICTION_MODE_NOT_PERMITTED with the reason, as the
  // positions route refuses its own policy checks. It used to surface as a
  // 500 "An unknown error occurred.". This answer comes after the ownership
  // check, so it tells a stranger nothing about a profile.
  let market: Awaited<ReturnType<VendorHypeOperationsPredictionService["createPredictionMarket"]>>
  try {
    market = await service.createPredictionMarket({
      ...body,
      starts_at: new Date(body.starts_at),
      locks_at: new Date(body.locks_at),
      settlement_deadline_at: body.settlement_deadline_at
        ? new Date(body.settlement_deadline_at)
        : undefined,
      created_by: actorId,
    })
  } catch (error) {
    if (isPredictionPolicyRefusal(error)) {
      const refusal = predictionPolicyDeniedResponse(error)
      return res.status(refusal.status).json(refusal.body)
    }
    throw error
  }

  res.status(201).json({ market })
}
