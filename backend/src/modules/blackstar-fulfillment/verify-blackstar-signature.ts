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
 * row. The five outbound events Blackstar's contract documents, nothing else.
 */
export const STATUS_FOR_BLACKSTAR_EVENT: Record<string, string> = {
  "shipment.claimed": "claimed",
  "shipment.in_transit": "in_transit",
  "shipment.delivered": "delivered",
  "shipment.disputed": "disputed",
  "shipment.cancelled": "cancelled",
}
