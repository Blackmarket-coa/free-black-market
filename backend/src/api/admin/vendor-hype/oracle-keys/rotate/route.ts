import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../modules/vendor-hype-operations-prediction/service"

const rotateSchema = z.object({
  old_key_id: z.string().min(1),
  new_key_id: z.string().min(1),
  new_public_key_pem: z.string().min(40),
  rotation_note: z.string().min(5),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const actorType = (req as any).auth_context?.actor_type
  if (actorType && actorType !== "admin" && actorType !== "user") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const body = rotateSchema.parse(req.body)
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const key = await service.rotateOracleSigningKey(body)
  res.json({ key, sop: "retire old key after downstream propagation and verification checks" })
}
