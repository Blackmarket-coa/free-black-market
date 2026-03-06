import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  PredictionMarketState,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../../modules/vendor-hype-operations-prediction/service"

const stateSchema = z.object({
  state: z.nativeEnum(PredictionMarketState),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const body = stateSchema.parse(req.body)
  const market = await service.transitionPredictionMarketState(req.params.id, body.state)
  res.json({ market })
}
