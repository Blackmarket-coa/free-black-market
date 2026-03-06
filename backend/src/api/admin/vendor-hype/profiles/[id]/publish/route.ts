import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../../modules/vendor-hype-operations-prediction/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const profile = await service.publishHypeProfile(req.params.id)
  res.json({ profile })
}
