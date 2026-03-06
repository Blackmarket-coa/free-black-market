import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { OracleSigningKeyStatus, VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../modules/vendor-hype-operations-prediction/service"

const schema = z.object({
  key_id: z.string().min(1),
  algorithm: z.string().default("ed25519"),
  public_key_pem: z.string().min(40),
  status: z.nativeEnum(OracleSigningKeyStatus).optional(),
  valid_from: z.string().datetime().optional(),
  valid_to: z.string().datetime().optional(),
  rotation_note: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const ensureAdmin = (req: MedusaRequest, res: MedusaResponse) => {
  const actorType = (req as any).auth_context?.actor_type
  if (actorType && actorType !== "admin" && actorType !== "user") {
    res.status(403).json({ error: "Forbidden" })
    return false
  }
  return true
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!ensureAdmin(req, res)) return
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )
  const keys = await service.listOracleSigningKeys({})
  res.json({ keys })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!ensureAdmin(req, res)) return
  const body = schema.parse(req.body)
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const key = await service.upsertOracleSigningKey({
    ...body,
    valid_from: body.valid_from ? new Date(body.valid_from) : undefined,
    valid_to: body.valid_to ? new Date(body.valid_to) : undefined,
  })

  res.status(201).json({ key })
}
