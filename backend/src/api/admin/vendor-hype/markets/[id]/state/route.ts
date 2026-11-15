import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "zod"
import {
  PredictionMarketState,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../../modules/vendor-hype-operations-prediction/service"

const stateSchema = z.object({
  state: z.nativeEnum(PredictionMarketState),
})

/**
 * Operator-only market lifecycle transition.
 *
 * This lived at POST /store/vendor-hype/markets/:id/state, where the only gate
 * was "any signed-in customer, seller or driver". Any such account could walk
 * any market one legal step at a time, DRAFT → SCHEDULED → OPEN → LOCKED →
 * IN_REVIEW → SETTLED, or void it from any state before that. The SETTLED
 * step wrote no settlement record and no payouts; it was shown on the real
 * stack, not inferred. The architecture puts publish, lock and void with the
 * operator (docs/VENDOR_HYPE_OPERATIONS_PREDICTION_BACKEND_ARCHITECTURE.md
 * §4.3, §5.2), so the route moved here.
 *
 * Medusa authenticates /admin/** as an admin `user` (bearer, session or
 * secret API key). This route also refuses anything that is not a signed-in
 * admin user, so a secret API key cannot drive a market. The service still
 * decides which transitions are legal, and it refuses SETTLED as a target:
 * settlement goes through POST /admin/vendor-hype/markets/:id/settle.
 *
 * Client mistakes answer 4xx, not 500: a bad body gets 400 here. The
 * service's typed errors become 404 for an unknown market and 400 for an
 * illegal transition, through the framework's error handler. A 5xx is
 * reported to Sentry, and an operator's typo is not a server error.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const actor = req.auth_context
  if (!actor?.actor_id || actor.actor_type !== "user") {
    return res.status(403).json({
      message: "Only an admin user may change a prediction market's state.",
      type: "not_allowed",
    })
  }

  const parsed = stateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: `state must be one of: ${Object.values(PredictionMarketState).join(", ")}`,
      type: "invalid_data",
    })
  }

  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const market = await service.transitionPredictionMarketState(
    req.params.id,
    parsed.data.state
  )
  res.json({ market })
}
