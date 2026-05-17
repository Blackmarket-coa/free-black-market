import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../../../../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../../../../../modules/blackstar-fulfillment/service"

type Body = {
  order_id: string
  fulfillment_id?: string
  fulfillment_node_id?: string
  pickup_point_id?: string
  vending_machine_id?: string
  external_status?: string
  metadata?: Record<string, unknown>
}

function isEnabled(): boolean {
  return process.env.FBM_BLACKSTAR_INTEGRATION === "1"
}

function verifyKey(req: MedusaRequest): boolean {
  const expected = process.env.FBM_BLACKSTAR_API_KEY
  if (!expected) return false
  const provided = req.headers["x-fbm-integration-key"]
  const providedStr = Array.isArray(provided) ? provided[0] : provided
  return typeof providedStr === "string" && providedStr === expected
}

/**
 * Inbound webhook receiver for Blackstar shipment status updates. Stub mode
 * returns 503 when the integration is disabled. Otherwise the API key
 * (`x-fbm-integration-key`) must match `FBM_BLACKSTAR_API_KEY`.
 *
 * Persists / updates the BlackstarShipment row keyed by order_id (and
 * fulfillment_id when supplied).
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  if (!isEnabled()) {
    return res
      .status(503)
      .json({ message: "Blackstar integration is disabled (FBM_BLACKSTAR_INTEGRATION!=1)" })
  }
  if (!verifyKey(req)) {
    return res.status(401).json({ message: "Invalid x-fbm-integration-key" })
  }

  const body = (req.validatedBody || req.body || {}) as Body
  if (!body.order_id) {
    return res.status(400).json({ message: "order_id is required" })
  }

  const service = req.scope.resolve<BlackstarFulfillmentModuleService>(
    BLACKSTAR_FULFILLMENT_MODULE
  )

  const shipment = await service.recordOrUpdateShipment({
    order_id: body.order_id,
    fulfillment_id: body.fulfillment_id ?? null,
    fulfillment_node_id: body.fulfillment_node_id ?? null,
    pickup_point_id: body.pickup_point_id ?? null,
    vending_machine_id: body.vending_machine_id ?? null,
    external_status: body.external_status ?? null,
    metadata: body.metadata ?? null,
  })
  return res.json({ shipment })
}
