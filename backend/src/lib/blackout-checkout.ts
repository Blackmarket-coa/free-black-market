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
