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
 * was "any signed-in customer, seller or driver", so any account could walk
 * any market from DRAFT to SETTLED or VOIDED. The architecture puts publish,
 * lock and void with the operator
 * (docs/VENDOR_HYPE_OPERATIONS_PREDICTION_BACKEND_ARCHITECTURE.md §4.3, §5.2),
 * so the route moved here. Medusa authenticates /admin/** as an admin `user`
 * (bearer, session or secret API key); this additionally refuses anything that
 * is not a signed-in admin user, so a secret API key cannot drive a market.
 * The service still enforces which transitions are legal.
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

  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const body = stateSchema.parse(req.body)
  const market = await service.transitionPredictionMarketState(
    req.params.id,
    body.state
  )
  res.json({ market })
}
