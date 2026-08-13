import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../../../../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../../../../../modules/blackstar-fulfillment/service"
import {
  STATUS_FOR_BLACKSTAR_EVENT,
  verifyBlackstarSignature,
} from "../../../../../modules/blackstar-fulfillment/verify-blackstar-signature"

type BlackstarEnvelope = {
  event_id?: string
  event_type?: string
  correlation_id?: string
  payload?: {
    shipment_listing_id?: string
    source_order_ref?: string
    claimed_by_node_id?: string | null
    status?: string
  }
}

function isEnabled(): boolean {
  return process.env.FBM_BLACKSTAR_INTEGRATION === "1"
}

/**
 * Receiver for Blackstar's outbound lifecycle events (shipment.claimed /
 * in_transit / delivered / disputed / cancelled), per the contract in the
 * Blackstar repo's `api/docs/events/freeblackmarket-contract.md`.
 *
 * Replaces the retired static-key `/v1/integrations/blackstar/shipments`
 * route: authentication is the timestamped HMAC scheme both directions of the
 * bridge now share (constant-time compare, bounded timestamp window), with
 * `BLACKSTAR_OUTBOUND_SECRET` holding the value Blackstar signs with as
 * `FBM_OUTBOUND_SECRET`.
 *
 * Idempotent by construction — applying the same event twice re-writes the
 * same shipment state. Unknown event types return 202 `ignored` rather than
 * an error so a newer Blackstar can add lifecycle events without dead-
 * lettering its deliveries against an older FBM.
 */
export async function POST(req: MedusaRequest<BlackstarEnvelope>, res: MedusaResponse) {
  if (!isEnabled()) {
    return res
      .status(503)
      .json({ message: "Blackstar integration is disabled (FBM_BLACKSTAR_INTEGRATION!=1)" })
  }

  const rawBodyBuf = (req as unknown as { rawBody?: Buffer }).rawBody
  const rawBody =
    rawBodyBuf && Buffer.isBuffer(rawBodyBuf)
      ? rawBodyBuf.toString("utf8")
      : JSON.stringify(req.body ?? {})

  const header = (name: string): string | undefined => {
    const v = req.headers[name]
    return Array.isArray(v) ? v[0] : v
  }

  const verdict = verifyBlackstarSignature({
    rawBody,
    timestampHeader: header("x-fbm-timestamp"),
    signatureHeader: header("x-fbm-signature"),
    secret: process.env.BLACKSTAR_OUTBOUND_SECRET,
    toleranceSeconds: Number(process.env.BLACKSTAR_SIGNATURE_TOLERANCE_SECONDS) || undefined,
  })
  if (!verdict.ok) {
    return res.status(verdict.status).json({ message: verdict.message })
  }

  const body = (req.body ?? {}) as BlackstarEnvelope
  const eventType = body.event_type ?? ""
  const payload = body.payload ?? {}
  const correlationId = header("x-correlation-id") ?? body.correlation_id ?? null

  const externalStatus = STATUS_FOR_BLACKSTAR_EVENT[eventType]
  if (!externalStatus) {
    return res.status(202).json({
      status: "ignored",
      event_id: body.event_id ?? null,
      correlation_id: correlationId,
    })
  }

  if (!payload.source_order_ref) {
    return res.status(400).json({ message: "payload.source_order_ref is required" })
  }

  const service = req.scope.resolve<BlackstarFulfillmentModuleService>(
    BLACKSTAR_FULFILLMENT_MODULE
  )

  const shipment = await service.recordOrUpdateShipment({
    order_id: payload.source_order_ref,
    fulfillment_node_id: payload.claimed_by_node_id ?? null,
    external_status: externalStatus,
    metadata: {
      shipment_listing_id: payload.shipment_listing_id ?? null,
      last_event_id: body.event_id ?? null,
      last_event_type: eventType,
      last_reported_status: payload.status ?? null,
    },
  })

  return res.status(202).json({
    status: "processed",
    event_id: body.event_id ?? null,
    correlation_id: correlationId,
    shipment_id: shipment.id,
  })
}
