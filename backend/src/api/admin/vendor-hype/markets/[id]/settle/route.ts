import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { z } from "zod"

const settleSchema = z.object({
  settlement_ref: z.string().min(1),
  oracle_outcome_key: z.string().min(1),
  oracle_evidence_uri: z.string().url(),
  oracle_payload: z.record(z.unknown()),
  oracle_signature: z.string().min(32),
  oracle_key_id: z.string().min(1),
  oracle_nonce: z.string().min(12),
  oracle_timestamp: z.string().datetime(),
  oracle_expires_at: z.string().datetime(),
  oracle_signature: z.string().min(10),
  dispute_window_ends_at: z.string().datetime().optional(),
  execution_run_id: z.string().optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const actorType = (req as any).auth_context?.actor_type
  if (actorType && actorType !== "user" && actorType !== "admin") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const eventBus: IEventBusModuleService = req.scope.resolve(Modules.EVENT_BUS)
  const body = settleSchema.parse(req.body)

  await eventBus.emit({
    name: "prediction.settlement.requested",
    data: {
      market_id: req.params.id,
      ...body,
      requested_by: (req as any).auth_context?.actor_id || "operator",
      execution_run_id: body.execution_run_id || `run_${Date.now()}`,
      requested_at: new Date().toISOString(),
    },
  })

  res.status(202).json({
    accepted: true,
    market_id: req.params.id,
    settlement_ref: body.settlement_ref,
  })
}
