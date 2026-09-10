import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../../../../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../../../../../modules/blackstar-fulfillment/service"
import {
  BLACKSTAR_EVENTS_WITHOUT_STATUS,
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
    // Relay-progress events (`shipment.leg.*`) only. They write no shipment
    // status; these are carried onto the receipt so the leg a skipped event
    // referred to is recoverable later.
    shipment_leg_id?: string
    sequence?: number
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
 * same shipment state. Event types that write no status return 202 `ignored`
 * rather than an error so a newer Blackstar can add events without dead-
 * lettering its deliveries against an older FBM. They are still **recorded**:
 * see `recordUnappliedEvent`, and the `reason` field that separates a relay
 * event this receiver knowingly skips from a type it has never heard of.
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
    // Still 202, and still no status write — but recorded rather than
    // dropped. These used to leave no trace at all, which meant a relay that
    // was arriving and being deliberately skipped looked, from this side,
    // exactly like a relay that was not arriving. The receipt table already
    // documented an `ignored` outcome; nothing could reach it.
    const documented = BLACKSTAR_EVENTS_WITHOUT_STATUS.has(eventType)
    try {
      await service.recordUnappliedEvent({
        event_id: body.event_id ?? null,
        event_type: eventType,
        source_order_ref: payload.source_order_ref ?? null,
        correlation_id: correlationId,
        documented,
        metadata: {
          shipment_listing_id: payload.shipment_listing_id ?? null,
          shipment_leg_id: payload.shipment_leg_id ?? null,
          sequence: payload.sequence ?? null,
          leg_status: payload.status ?? null,
        },
      })
    } catch {
      // Bookkeeping must not fail an event the sender got right.
    }

    return res.status(202).json({
      status: "ignored",
      // `status` stays "ignored" so Blackstar's existing handling is
      // unchanged; `reason` is additive and says which kind this was. An
      // `unknown_event_type` means the bridge has outrun this deployment.
      reason: documented ? "no_status_change" : "unknown_event_type",
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
