import { createHmac, timingSafeEqual } from "crypto"

/**
 * Verification for Blackstar→FBM webhook signatures — the receiving half of
 * the scheme Blackstar's OutboundEventPublisher signs with: HMAC-SHA256 over
 * `"{X-FBM-Timestamp}.{raw_body}"`, hex-encoded, with a bounded timestamp
 * window as the replay defense. Kept pure so the rejection matrix is unit-
 * testable without an HTTP harness.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: number; message: string }

export function verifyBlackstarSignature(args: {
  rawBody: string
  timestampHeader: string | undefined
  signatureHeader: string | undefined
  secret: string | undefined
  nowSeconds?: number
  toleranceSeconds?: number
}): VerifyResult {
  const secret = args.secret ?? ""
  if (secret === "") {
    // An unconfigured secret disables the integration; it must never
    // authenticate against an empty key.
    return { ok: false, status: 503, message: "Blackstar integration is not configured." }
  }

  const ts = args.timestampHeader ?? ""
  if (!/^\d+$/.test(ts)) {
    return { ok: false, status: 401, message: "Missing or malformed timestamp." }
  }

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  if (Math.abs(now - Number(ts)) > tolerance) {
    return { ok: false, status: 401, message: "Stale signature." }
  }

  const provided = args.signatureHeader ?? ""
  const expected = createHmac("sha256", secret)
    .update(`${ts}.${args.rawBody}`)
    .digest("hex")

  const providedBuf = Buffer.from(provided, "utf8")
  const expectedBuf = Buffer.from(expected, "utf8")
  const matches =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf)

  if (!matches) {
    return { ok: false, status: 401, message: "Invalid signature." }
  }

  return { ok: true }
}

/**
 * external_status a Blackstar lifecycle event maps onto the BlackstarShipment
 * row. The five LISTING-LEVEL events, which are the only ones that assert
 * where a shipment as a whole has got to.
 */
export const STATUS_FOR_BLACKSTAR_EVENT: Record<string, string> = {
  "shipment.claimed": "claimed",
  "shipment.in_transit": "in_transit",
  "shipment.delivered": "delivered",
  "shipment.disputed": "disputed",
  "shipment.cancelled": "cancelled",
}

/**
 * Events Blackstar's contract documents that deliberately carry **no**
 * shipment status.
 *
 * The relay emits one of these per leg transition and per handoff proof.
 * They report a leg's progress, and the contract is explicit that a receiver
 * must not derive a listing status from them: a leg reaching `completed` says
 * nothing about whether the shipment is delivered, because there may be four
 * more legs. Blackstar sends the listing-level event separately when the
 * whole shipment moves.
 *
 * They are listed here rather than left to fall through the unknown-type
 * branch so that "a relay event we knowingly do not act on" is distinguishable
 * from "an event type this FBM has never heard of". Both are answered 202 and
 * neither writes a status; only the second one means the bridge has outrun
 * this deployment.
 *
 * Blackstar emitted these two for as long as the leg relay has existed and
 * documented neither, which is why this map used to have five entries and no
 * second set — see the Blackstar repo's `api/docs/events/freeblackmarket-contract.md`,
 * corrected 2026-09-10 in the same pass as this.
 */
export const BLACKSTAR_EVENTS_WITHOUT_STATUS: ReadonlySet<string> = new Set([
  "shipment.leg.updated",
  "shipment.leg.handoff_proof",
])
