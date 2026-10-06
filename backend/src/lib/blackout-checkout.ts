import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { SubscriptionInterval } from "../modules/subscription/types"

/**
 * Helpers for the Blackout-initiated checkout flow (W1b). The pure functions
 * (metadata bounding, recurrence mapping, payment-session field extraction)
 * are unit-tested without a container; the container helpers wrap the small
 * lookups the session page needs (region by currency, customer email).
 */

// ---------------------------------------------------------------------------
// Bounded metadata echo
// ---------------------------------------------------------------------------

export const CHECKOUT_METADATA_MAX_KEYS = 20
export const CHECKOUT_METADATA_MAX_KEY_LENGTH = 64
export const CHECKOUT_METADATA_MAX_VALUE_LENGTH = 500

/**
 * Bound the caller-supplied metadata echo: string→string only, capped key
 * count and lengths. Returns null when nothing valid remains. Keys the
 * checkout itself stamps (blackout_user_id, creator_listing_id, ...) always
 * win over echoed keys, so a caller cannot spoof identity fields.
 */
export function sanitizeCheckoutMetadata(
  input: unknown
): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const out: Record<string, string> = {}
  let count = 0
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= CHECKOUT_METADATA_MAX_KEYS) break
    if (typeof value !== "string") continue
    if (!key || key.length > CHECKOUT_METADATA_MAX_KEY_LENGTH) continue
    if (value.length > CHECKOUT_METADATA_MAX_VALUE_LENGTH) continue
    out[key] = value
    count++
  }
  return count > 0 ? out : null
}

// ---------------------------------------------------------------------------
// Listing recurrence -> subscription shape
// ---------------------------------------------------------------------------

export interface ListingRecurrence {
  interval: SubscriptionInterval
  /** Number of interval cycles until `expiration_date` (module semantics). */
  period: number
}

const INTERVAL_VALUES = new Set<string>(Object.values(SubscriptionInterval))

/**
 * ~1-year subscription horizon per interval; renewals advance
 * `next_order_date` cycle by cycle until `expiration_date`.
 */
const DEFAULT_PERIOD_BY_INTERVAL: Record<SubscriptionInterval, number> = {
  [SubscriptionInterval.WEEKLY]: 52,
  [SubscriptionInterval.BIWEEKLY]: 26,
  [SubscriptionInterval.MONTHLY]: 12,
  [SubscriptionInterval.QUARTERLY]: 4,
  [SubscriptionInterval.YEARLY]: 1,
}

/**
 * Map a listing's recurrence columns to the subscription module's
 * (interval, period). Returns null for non-subscription listings. A
 * subscription-category listing with no explicit interval defaults to
 * monthly — the shape every seeded Blackout tier uses.
 */
export function mapListingRecurrence(listing: {
  category?: string | null
  interval?: string | null
}): ListingRecurrence | null {
  if (listing.category !== "subscription") return null
  const raw = (listing.interval ?? "monthly").toLowerCase()
  const interval = INTERVAL_VALUES.has(raw)
    ? (raw as SubscriptionInterval)
    : SubscriptionInterval.MONTHLY
  return { interval, period: DEFAULT_PERIOD_BY_INTERVAL[interval] }
}

// ---------------------------------------------------------------------------
// Payment session field extraction (Stripe provider snapshots)
// ---------------------------------------------------------------------------

/**
 * Pull the Stripe client secret out of a payment session's provider data
 * snapshot, wherever the provider version put it.
 */
export function extractStripeClientSecret(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const direct = record["client_secret"] ?? record["clientSecret"]
  if (typeof direct === "string" && direct.length > 0) return direct
  const nested = record["data"]
  if (nested && typeof nested === "object") {
    const inner = (nested as Record<string, unknown>)["client_secret"]
    if (typeof inner === "string" && inner.length > 0) return inner
  }
  return null
}

/**
 * Pull the saved payment method id from an authorized payment session's
 * provider data (Stripe: the PaymentIntent's `payment_method`, as an id or an
 * expanded object). This is what the renewal workflow charges off-session.
 */
export function extractPaymentMethodId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const pm = record["payment_method"] ?? record["payment_method_id"]
  if (typeof pm === "string" && pm.length > 0) return pm
  if (pm && typeof pm === "object") {
    const id = (pm as Record<string, unknown>)["id"]
    if (typeof id === "string" && id.length > 0) return id
  }
  const nested = record["data"]
  if (nested && typeof nested === "object") {
    return extractPaymentMethodId(nested)
  }
  return null
}

// ---------------------------------------------------------------------------
// Auto-renew approval (FF_CONSUMER_SUBSCRIPTIONS_V1)
// ---------------------------------------------------------------------------

/**
 * The member's answer to the auto-renew question as the hosted page carries
 * it to `?action=complete` (query string) or the JSON POST (body): exactly
 * `true`/`false`, as a boolean or its string form. Anything else — absent,
 * empty, "on", "1", an array from a repeated parameter — is null, and the
 * completion refuses it rather than guessing.
 */
export function parseAutoRenewAnswer(raw: unknown): boolean | null {
  if (raw === true || raw === "true") return true
  if (raw === false || raw === "false") return false
  return null
}

type RequestHeaders = Record<string, string | string[] | undefined>

function singleHeader(headers: RequestHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name]
  return typeof value === "string" ? value : undefined
}

/**
 * Whether a render of the hosted page was navigated to by the page itself
 * (its own auto-renew toggle), rather than by whoever built the URL: the
 * integrator setting an iframe `src` or navigating the frame from the parent,
 * a link from another site, a typed or bookmarked URL. Only the first can
 * carry the member's own tick, so only it may render the box ticked.
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be set by page script or
 * by a parent frame; the toggle's navigation is the only one that reads
 * `same-origin` (the frame's own document initiated it). A browser that sends
 * no Fetch Metadata falls back to the Referer, whose host must be this one;
 * neither header present means not verified. Failing closed is the safe
 * direction: the box renders unticked and the card is not kept.
 */
export function navigatedFromOwnPage(headers: RequestHeaders | undefined): boolean {
  const site = singleHeader(headers, "sec-fetch-site")
  if (site !== undefined) return site === "same-origin"
  const referer = singleHeader(headers, "referer")
  const host = singleHeader(headers, "host")
  if (!referer || !host) return false
  try {
    return new URL(referer).host === host
  } catch {
    return false
  }
}

/**
 * Whether a payment session asked the provider to keep the card for
 * off-session use (Stripe's `setup_future_usage: "off_session"`, as the
 * provider stores the PaymentIntent on the session). This is the fact that
 * decides whether a card is saved for renewals at all, so the hosted checkout
 * reads it back rather than trusting what it meant to send.
 */
export function paymentSessionKeepsCard(data: unknown): boolean {
  if (!data || typeof data !== "object") return false
  const record = data as Record<string, unknown>
  if (record["setup_future_usage"] === "off_session") return true
  const nested = record["data"]
  return !!nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)["setup_future_usage"] === "off_session"
    : false
}

/**
 * The PaymentIntent metadata key that marks a session the hosted checkout
 * started for an approval it verified (the member's own tick on the page),
 * valued with the disclosure version the page showed. The Stripe provider
 * merges the session `data.metadata` into the intent's metadata, and the
 * intent is what the session stores, so the mark is read back from the same
 * snapshot as `setup_future_usage`. A session that keeps the card without this
 * mark was never started for an approval: it predates the question.
 */
export const AUTO_RENEW_APPROVAL_METADATA_KEY = "fbm_auto_renew_disclosure_version"

/** The disclosure version a payment session was started to approve, or null. */
export function paymentSessionApprovalVersion(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const metadata = record["metadata"]
  if (metadata && typeof metadata === "object") {
    const version = (metadata as Record<string, unknown>)[AUTO_RENEW_APPROVAL_METADATA_KEY]
    if (typeof version === "string" && version.length > 0) return version
  }
  const nested = record["data"]
  return nested && typeof nested === "object" ? paymentSessionApprovalVersion(nested) : null
}

/**
 * What a payment session was started for, read back from what it is:
 * `approved` (keeps the card, marked with the version approved), `declined`
 * (does not keep the card), or `unasked` (keeps the card with no mark: a
 * session started before the hosted checkout asked the question).
 */
export type PaymentSessionAnswer =
  | { kind: "approved"; disclosure_version: string }
  | { kind: "declined" }
  | { kind: "unasked" }

export function paymentSessionAnswer(data: unknown): PaymentSessionAnswer {
  if (!paymentSessionKeepsCard(data)) return { kind: "declined" }
  const version = paymentSessionApprovalVersion(data)
  return version ? { kind: "approved", disclosure_version: version } : { kind: "unasked" }
}

const PAID_INTENT_STATUSES = new Set(["requires_capture", "processing", "succeeded"])

/**
 * Whether a payment session may already have been paid: authorized/captured
 * in Medusa, or a provider snapshot whose PaymentIntent is past confirmation.
 * Such a session is never replaced to change its card-saving setting.
 */
export function paymentSessionMayBePaid(session: {
  status?: string | null
  data?: unknown
} | null | undefined): boolean {
  if (!session) return false
  if (session.status === "authorized" || session.status === "captured") return true
  const status =
    session.data && typeof session.data === "object"
      ? (session.data as Record<string, unknown>)["status"]
      : undefined
  return typeof status === "string" && PAID_INTENT_STATUSES.has(status)
}

/**
 * The price per period as the disclosure names it, e.g. "$10.00". `total` is
 * the cart total in major units (Medusa v2). Falls back to "<total> <CODE>"
 * when the currency code is not one Intl knows.
 */
export function formatCheckoutPrice(
  total: string | number | null | undefined,
  currency: string | null | undefined
): string {
  const amount = Number(total)
  const code = (currency ?? "").toUpperCase()
  if (total === null || total === undefined || total === "" || !Number.isFinite(amount)) {
    return code ? `— ${code}` : "—"
  }
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount)
  } catch {
    return `${amount} ${code}`.trim()
  }
}

// ---------------------------------------------------------------------------
// Container helpers
// ---------------------------------------------------------------------------

type QueryLike = {
  graph: (q: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: Array<Record<string, unknown>> }>
}

function query(container: MedusaContainer): QueryLike {
  return container.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
}

/**
 * Find the region a cart in `currency` should live in: the first region
 * carrying that currency, else the store's default region.
 */
export async function resolveRegionIdForCurrency(
  container: MedusaContainer,
  currency: string
): Promise<string | null> {
  const currencyCode = currency.toLowerCase()
  try {
    const { data } = await query(container).graph({
      entity: "region",
      fields: ["id", "currency_code"],
      filters: { currency_code: currencyCode },
    })
    const match = data?.find((r) => r.currency_code === currencyCode)
    if (match && typeof match.id === "string") return match.id
  } catch {
    // fall through to store default
  }
  try {
    const storeService = container.resolve(Modules.STORE) as unknown as {
      listStores: (
        f?: Record<string, unknown>,
        c?: Record<string, unknown>
      ) => Promise<Array<{ default_region_id?: string | null }>>
    }
    const [store] = await storeService.listStores({}, { take: 1 })
    return store?.default_region_id ?? null
  } catch {
    return null
  }
}

export async function getCustomerEmailAndMxid(
  container: MedusaContainer,
  customerId: string
): Promise<{ email: string | null; mxid: string | null }> {
  try {
    const customerService = container.resolve(Modules.CUSTOMER) as unknown as {
      retrieveCustomer: (
        id: string,
        c?: Record<string, unknown>
      ) => Promise<{ email?: string | null; metadata?: Record<string, unknown> | null }>
    }
    const customer = await customerService.retrieveCustomer(customerId)
    const mxid = customer?.metadata?.["mxid"]
    return {
      email: customer?.email ?? null,
      mxid: typeof mxid === "string" && mxid.length > 0 ? mxid : null,
    }
  } catch {
    return { email: null, mxid: null }
  }
}
