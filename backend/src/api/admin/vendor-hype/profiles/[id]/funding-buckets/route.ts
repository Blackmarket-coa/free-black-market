import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  OpsFundingBucketCode,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../../modules/vendor-hype-operations-prediction/service"

const upsertSchema = z.object({
  id: z.string().optional(),
  code: z.nativeEnum(OpsFundingBucketCode),
  name: z.string().min(1),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const buckets = await service.listFundingBuckets(req.params.id)
  res.json({ buckets })
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const body = upsertSchema.parse(req.body)
  const bucket = await service.upsertFundingBucket({
    ...body,
    profile_id: req.params.id,
  })

  res.json({ bucket })
}
