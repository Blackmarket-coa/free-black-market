import { createHmac, timingSafeEqual } from "crypto"
import { featureFlagState } from "../../shared/feature-flags"

/**
 * Black Mask provisioning channel (F3) -- the pure half: config, the vault
 * marker, the event id, the payload, the signature, the send-time email rule
 * and the retry ladder. No I/O lives here; the service (enqueue, claim, send)
 * and `lib/black-mask-provisioning.ts` (event -> payload) build on it.
 *
 * Wire contract: docs/BLACK_MASK_PROVISIONING_CONTRACT.md. Change one, change
 * the other.
 */

/**
 * Sentinel `subscription_id` for Black Mask rows in
 * `marketplace_webhook_delivery`, beside `blackout-global` and
 * `blackstar-global`. Never a real webhook-subscription row.
 */
export const BLACK_MASK_SUBSCRIPTION_ID = "black-mask-global"

/** Product metadata key naming the Black Mask plan a vault product sells. */
export const BLACK_MASK_PLAN_METADATA_KEY = "black_mask_plan"

export const BLACK_MASK_EVENTS = [
  "placed",
  "renewed",
  "cancelled",
  "payment_failed",
  "grace_started",
  "read_only",
  "expired",
] as const

export type BlackMaskEvent = (typeof BLACK_MASK_EVENTS)[number]

export function isBlackMaskEvent(value: unknown): value is BlackMaskEvent {
  return typeof value === "string" && (BLACK_MASK_EVENTS as readonly string[]).includes(value)
}

/**
 * Delay in minutes after failed attempt N (index N-1). Seven gaps, eight
 * attempts: 1m, 5m, 30m, 2h, 6h, 12h, 24h = 2,676 minutes (about 44.6 hours)
 * from the first attempt to the last. The shared [1, 5, 30] ladder the other
 * channels use gives up after ~36 minutes, which is shorter than an ordinary
 * outage of a small self-hosted service.
 */
export const BLACK_MASK_RETRY_LADDER_MINUTES = [1, 5, 30, 120, 360, 720, 1440] as const
export const BLACK_MASK_MAX_ATTEMPTS = BLACK_MASK_RETRY_LADDER_MINUTES.length + 1

/** Per-attempt fetch timeout. A hung receiver costs one attempt, not the drain. */
export const BLACK_MASK_FETCH_TIMEOUT_MS = 10_000

/**
 * How long a claim holds a row. Longer than the fetch timeout by a wide margin,
 * so a row is only re-claimable after the process that claimed it has either
 * finished or died.
 */
export const BLACK_MASK_CLAIM_LEASE_MS = 120_000

/** Receiver-side tolerance on X-FBM-Timestamp, documented in the contract. */
export const BLACK_MASK_SIGNATURE_TOLERANCE_SECONDS = 300

export interface BlackMaskConfig {
  url: string
  secret: string
  keyId: string
  sellerId: string
}

/**
 * Resolved channel config, or null when any of the four values is unset (the
 * channel is then a no-op: nothing enqueued, nothing sent). Read from
 * process.env at call time, like blackstarEmitConfig(), so tests flip it per
 * case. A plain-http destination is refused in production.
 */
export function blackMaskProvisioningConfig(): BlackMaskConfig | null {
  const url = process.env.BLACK_MASK_PROVISIONING_URL?.trim()
  const secret = process.env.BLACK_MASK_WEBHOOK_SECRET
  const keyId = process.env.BLACK_MASK_WEBHOOK_KEY_ID?.trim()
  const sellerId = process.env.BLACK_MASK_SELLER_ID?.trim()
  if (!url || !secret || !keyId || !sellerId) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:") {
    if (parsed.protocol !== "http:" || process.env.NODE_ENV === "production") {
      return null
    }
  }
  return { url, secret, keyId, sellerId }
}

export function isBlackMaskProvisioningEnabled(): boolean {
  return featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")
}

const PLAN_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/**
 * The plan code on a product's metadata, or null. Product metadata is written
 * by the product's seller (here, BMC), unlike line-item and cart metadata,
 * which the store API lets the customer set.
 */
export function blackMaskPlanCode(productMetadata: unknown): string | null {
  if (!productMetadata || typeof productMetadata !== "object") return null
  const raw = (productMetadata as Record<string, unknown>)[BLACK_MASK_PLAN_METADATA_KEY]
  if (typeof raw !== "string") return null
  const code = raw.trim()
  return PLAN_CODE.test(code) ? code : null
}

/**
 * The vault marker. A line is a Black Mask vault line only when BOTH hold:
 *   - the product's seller (the Mercur seller<->product link) is the
 *     configured BMC seller, and
 *   - the product's own metadata carries a `black_mask_plan` code.
 * Never reads line-item, cart or order metadata.
 */
export function isBlackMaskVaultLine(
  line: { productSellerId: string | null | undefined; productMetadata: unknown },
  sellerId: string
): boolean {
  if (!sellerId || !line.productSellerId) return false
  if (line.productSellerId !== sellerId) return false
  return blackMaskPlanCode(line.productMetadata) !== null
}

export type BlackMaskSubjectType = "order" | "subscription"

export interface BlackMaskSubject {
  type: BlackMaskSubjectType
  id: string
}

/**
 * Sequence from a record timestamp: epoch milliseconds. Every event's sequence
 * comes from the record that changed (order.created_at, subscription.canceled_at,
 * metadata.dunning_last_attempt_at, ...), never from the attempt, so a
 * redelivered Medusa event computes the same number, and later transitions of
 * one subject compute larger ones.
 */
export function sequenceFrom(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/**
 * Idempotency key per (subject, event, sequence), stored in the outbox's
 * unique `event_id` column, so a duplicate enqueue is a no-op.
 */
export function blackMaskEventId(
  subject: BlackMaskSubject,
  event: BlackMaskEvent,
  sequence: number
): string {
  return `bm:v1:${subject.type}:${subject.id}:${event}:${sequence}`
}

/**
 * What the outbox row stores. Minimised on purpose: ids, a plan code, a seat
 * count and a date. No email, name, address, amount or Blackout identity. The
 * email for `placed` is added at send time and never written here.
 */
export interface BlackMaskStoredPayload {
  event: BlackMaskEvent
  event_id: string
  sequence: number
  occurred_at: string
  subject: BlackMaskSubject
  customer_id: string | null
  plan: string
  seats: number
  seller_id: string
  period_end?: string
  /** On order-subject events: the subscription the order belongs to, via the subscription<->order link. */
  subscription_id?: string
  /** On `renewed`: the renewal order. */
  order_id?: string
}

export function buildBlackMaskPayload(input: {
  event: BlackMaskEvent
  subject: BlackMaskSubject
  sequence: number
  customerId: string | null | undefined
  plan: string
  seats: number | null | undefined
  sellerId: string
  periodEnd?: Date | string | null
  subscriptionId?: string | null
  orderId?: string | null
}): BlackMaskStoredPayload {
  const seatsRaw = Number(input.seats ?? 1)
  const seats = Number.isInteger(seatsRaw) && seatsRaw > 0 ? seatsRaw : 1
  const periodEndMs = sequenceFrom(input.periodEnd ?? null)

  const payload: BlackMaskStoredPayload = {
    event: input.event,
    event_id: blackMaskEventId(input.subject, input.event, input.sequence),
    sequence: input.sequence,
    occurred_at: new Date(input.sequence).toISOString(),
    subject: { type: input.subject.type, id: input.subject.id },
    customer_id: input.customerId ?? null,
    plan: input.plan,
    seats,
    seller_id: input.sellerId,
  }
  if (periodEndMs !== null) payload.period_end = new Date(periodEndMs).toISOString()
  if (input.subscriptionId) payload.subscription_id = input.subscriptionId
  if (input.orderId) payload.order_id = input.orderId
  return payload
}

export function isBlackMaskStoredPayload(value: unknown): value is BlackMaskStoredPayload {
  if (!value || typeof value !== "object") return false
  const p = value as Record<string, unknown>
  const subject = p.subject as Record<string, unknown> | undefined
  return (
    isBlackMaskEvent(p.event) &&
    typeof p.event_id === "string" &&
    typeof p.sequence === "number" &&
    typeof p.plan === "string" &&
    typeof p.seller_id === "string" &&
    !!subject &&
    (subject.type === "order" || subject.type === "subscription") &&
    typeof subject.id === "string"
  )
}

/**
 * The email that may leave FBM for an invite, or null. Omitted for the
 * placeholder addresses FBM mints itself: Blackout-native customers
 * (`blackout+<sub>@users.blackout.invalid`, `metadata.synthetic_email: true`,
 * lib/blackout-identity.ts) and erased customers (`deleted-<id>@deleted.invalid`,
 * api/store/customers/me/deletion). `.invalid` is reserved by RFC 2606, so no
 * real mailbox can carry it.
 */
export function deliverableEmail(
  customer: { email?: string | null; metadata?: unknown } | null | undefined
): string | null {
  if (!customer) return null
  const metadata =
    customer.metadata && typeof customer.metadata === "object"
      ? (customer.metadata as Record<string, unknown>)
      : {}
  if (metadata.synthetic_email === true) return null
  const email = typeof customer.email === "string" ? customer.email.trim() : ""
  if (!email || !email.includes("@")) return null
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase()
  if (!domain || domain === "invalid" || domain.endsWith(".invalid")) return null
  return email
}

/**
 * The exact bytes sent. The stored payload, plus `customer_email` on `placed`
 * only and only when a deliverable address was resolved at send time.
 */
export function buildBlackMaskWireBody(
  payload: BlackMaskStoredPayload,
  email: string | null
): string {
  if (payload.event === "placed" && email) {
    return JSON.stringify({ ...payload, customer_email: email })
  }
  return JSON.stringify(payload)
}

/** Lowercase hex HMAC-SHA256 over `"{timestamp}.{raw_body}"` (the Blackstar recipe). */
export function signBlackMaskBody(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
}

/**
 * Reference verifier for the receiver (and the tests): constant-time compare,
 * timestamp within +/- toleranceSeconds of now.
 */
export function verifyBlackMaskSignature(args: {
  secret: string
  timestamp: string
  rawBody: string
  signature: string
  nowSeconds?: number
  toleranceSeconds?: number
}): boolean {
  if (!/^\d+$/.test(args.timestamp)) return false
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = args.toleranceSeconds ?? BLACK_MASK_SIGNATURE_TOLERANCE_SECONDS
  if (Math.abs(now - Number(args.timestamp)) > tolerance) return false
  const expected = Buffer.from(signBlackMaskBody(args.secret, args.timestamp, args.rawBody), "hex")
  const given = /^[0-9a-f]+$/i.test(args.signature) ? Buffer.from(args.signature, "hex") : Buffer.alloc(0)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Minutes until the next attempt after failed attempt `attempt`, or null when the row goes dead. */
export function blackMaskRetryDelayMinutes(attempt: number): number | null {
  if (attempt >= BLACK_MASK_MAX_ATTEMPTS) return null
  return BLACK_MASK_RETRY_LADDER_MINUTES[Math.max(0, attempt - 1)] ?? null
}

/** Send-time customer lookup the drain is handed; returns null when there is no such customer. */
export type BlackMaskCustomerLookup = (
  customerId: string
) => Promise<{ email?: string | null; metadata?: unknown } | null>
