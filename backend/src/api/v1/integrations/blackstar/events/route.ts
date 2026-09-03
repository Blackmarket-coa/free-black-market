import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../../../../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../../../../../modules/blackstar-fulfillment/service"
import {
  STATUS_FOR_BLACKSTAR_EVENT,
  verifyBlackstarSignature,
} from "../../../../../modules/blackstar-fulfillment/verify-blackstar-signature"
import { resolveBlackstarVerificationSecret } from "../../../../../modules/blackstar-fulfillment/resolve-verification-secret"

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

  const service = req.scope.resolve<BlackstarFulfillmentModuleService>(
    BLACKSTAR_FULFILLMENT_MODULE
  )

  // Per-partner machine credentials: X-FBM-Key-ID selects the verifying
  // secret; the global BLACKSTAR_OUTBOUND_SECRET remains only as a migration
  // path while BLACKSTAR_REQUIRE_KEY_ID != 1.
  const resolution = await resolveBlackstarVerificationSecret({
    keyIdHeader: header("x-fbm-key-id"),
    lookup: (keyId) => service.findActiveBridgeSecret(keyId),
    globalSecret: process.env.BLACKSTAR_OUTBOUND_SECRET,
    requireKeyId: process.env.BLACKSTAR_REQUIRE_KEY_ID === "1",
  })
  if (!resolution.ok) {
    return res.status(resolution.status).json({ message: resolution.message })
  }

  const verdict = verifyBlackstarSignature({
    rawBody,
    timestampHeader: header("x-fbm-timestamp"),
    signatureHeader: header("x-fbm-signature"),
    secret: resolution.secret,
    toleranceSeconds: Number(process.env.BLACKSTAR_SIGNATURE_TOLERANCE_SECONDS) || undefined,
  })
  if (!verdict.ok) {
    return res.status(verdict.status).json({ message: verdict.message })
  }

  if (resolution.credentialId) {
    // Best-effort usage stamp — a bookkeeping failure must not fail the event.
    try {
      await service.touchBridgeCredential(resolution.credentialId)
    } catch {
      // ignored
    }
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

  const result = await service.applyBlackstarEvent({
    event_id: body.event_id ?? null,
    event_type: eventType,
    source_order_ref: payload.source_order_ref,
    correlation_id: correlationId,
    external_status: externalStatus,
    fulfillment_node_id: payload.claimed_by_node_id ?? null,
    metadata: {
      shipment_listing_id: payload.shipment_listing_id ?? null,
      last_reported_status: payload.status ?? null,
    },
  })

  // Every outcome is a 202. A replay, an out-of-order event and a
  // post-terminal event are all things the sender did correctly under an
  // at-least-once contract with no ordering guarantee — answering with an
  // error would make Blackstar retry, and retrying is exactly what produced
  // the out-of-order delivery in the first place. The body says what
  // actually happened so an operator can tell them apart.
  return res.status(202).json({
    status: result.processed ? "processed" : "duplicate",
    outcome: result.decision.reason,
    applied: result.decision.apply,
    event_id: body.event_id ?? null,
    correlation_id: correlationId,
    shipment_id: result.shipment_id,
    shipment_status: result.resulting_status,
  })
}
