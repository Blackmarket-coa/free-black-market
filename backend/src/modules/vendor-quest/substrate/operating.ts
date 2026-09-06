import { CustomerTierType } from "../../vendor-rules/models/vendor-customer-tier"
import type { ChannelSummary } from "../types"

/**
 * Pure order / tier arithmetic behind the universal substrate fields that
 * `build.ts` left at their zero defaults until 2026-09-06 —
 * `operating.orders_fulfilled`, `operating.fulfillment_reliability`,
 * `customers.*` and `customers.wholesale_relationships`
 * (`docs/CDFI_COOP_ROADMAP.md` §1a). Container-free, like `revenue.ts`, so every
 * figure a packet prints is reproducible from the rows it was computed from.
 */

/** The order columns the substrate reads; everything else is ignored. */
export interface SellerOrderRecord {
  id: string
  customer_id?: string | null
  created_at?: string | Date | null
  canceled_at?: string | Date | null
  status?: string | null
  fulfillment_status?: string | null
}

/** The `vendor_customer_tier` columns the substrate reads. */
export interface CustomerTierRecord {
  id?: string
  tier_type?: string | null
  name?: string | null
  active?: boolean | null
  /** Untyped JSON column; treated as `string[]` only when it is one. */
  customer_ids?: unknown
}

/**
 * Medusa `fulfillment_status` values where the vendor has acted on every line:
 * a fulfillment exists for all items (`fulfilled`), or they are on their way
 * or arrived. Partial states (`partially_*`) are neither counted as fulfilled
 * nor held against the vendor — an order with an unfulfilled line is not a
 * fulfilled order, and one with a shipped line is not a failure.
 */
export const FULFILLED_STATUSES: readonly string[] = ["fulfilled", "shipped", "delivered"]

/** Values where the vendor has not yet fulfilled the whole order. */
const UNFULFILLED_STATUSES: readonly string[] = ["not_fulfilled", "partially_fulfilled"]

/** An unfulfilled, uncanceled order older than this counts as a failure. */
export const STALE_UNFULFILLED_DAYS = 30

/**
 * Below this many decided orders reliability is `null`: "not enough history",
 * which `fulfillmentReliabilityAtLeast` reads as not proven. Matches Q5's first
 * gate (five fulfilled orders) so a vendor is never judged on a handful.
 */
export const RELIABILITY_MIN_SAMPLE = 5

export function isCanceledOrder(order: SellerOrderRecord): boolean {
  return (
    Boolean(order.canceled_at) ||
    order.status === "canceled" ||
    order.fulfillment_status === "canceled"
  )
}

export function isFulfilledOrder(order: SellerOrderRecord): boolean {
  return !isCanceledOrder(order) && FULFILLED_STATUSES.includes(order.fulfillment_status ?? "")
}

function isStaleUnfulfilled(order: SellerOrderRecord, asOf: Date): boolean {
  if (isCanceledOrder(order)) return false
  if (!UNFULFILLED_STATUSES.includes(order.fulfillment_status ?? "not_fulfilled")) return false
  const created = order.created_at ? new Date(order.created_at).getTime() : Number.NaN
  if (Number.isNaN(created)) return false
  return asOf.getTime() - created >= STALE_UNFULFILLED_DAYS * 86_400_000
}

/**
 * `orders_fulfilled` is the count of fulfilled orders. `fulfillment_reliability`
 * is fulfilled ÷ decided, where a decided order is fulfilled, canceled, or left
 * unfulfilled for `STALE_UNFULFILLED_DAYS`; orders still inside that window and
 * partially shipped ones are undecided and excluded from both sides. A canceled
 * order counts against the vendor whoever canceled it — the substrate reports,
 * the quest decides what to make of it.
 */
export function summarizeOrders(
  orders: SellerOrderRecord[],
  asOf: Date
): { orders_fulfilled: number; fulfillment_reliability: number | null } {
  let fulfilled = 0
  let failed = 0
  for (const order of orders) {
    if (isFulfilledOrder(order)) fulfilled += 1
    else if (isCanceledOrder(order) || isStaleUnfulfilled(order, asOf)) failed += 1
  }
  const decided = fulfilled + failed
  return {
    orders_fulfilled: fulfilled,
    fulfillment_reliability:
      decided >= RELIABILITY_MIN_SAMPLE ? round2(fulfilled / decided) : null,
  }
}

/** Distinct and repeat buyers over the seller's uncanceled orders. */
export function summarizeCustomers(orders: SellerOrderRecord[]): {
  distinct_customers: number
  repeat_customers: number
  repeat_rate: number | null
} {
  const byCustomer = new Map<string, number>()
  for (const order of orders) {
    if (isCanceledOrder(order)) continue
    const customerId = order.customer_id
    if (!customerId) continue
    byCustomer.set(customerId, (byCustomer.get(customerId) ?? 0) + 1)
  }
  const distinct = byCustomer.size
  const repeat = [...byCustomer.values()].filter((n) => n > 1).length
  return {
    distinct_customers: distinct,
    repeat_customers: repeat,
    repeat_rate: distinct > 0 ? round2(repeat / distinct) : null,
  }
}

/**
 * A wholesale relationship is a distinct customer on one of the seller's
 * active `WHOLESALE` tiers — the tier the wholesale-application approval path
 * adds buyers to. Distinct customers, not tiers: a nursery's channel setup
 * creates three `WHOLESALE` tiers at once, and a buyer can sit in several.
 */
export function countWholesaleRelationships(tiers: CustomerTierRecord[]): number {
  const customers = new Set<string>()
  for (const tier of tiers) {
    if (tier.active === false) continue
    if (tier.tier_type !== CustomerTierType.WHOLESALE) continue
    const ids = Array.isArray(tier.customer_ids) ? tier.customer_ids : []
    for (const id of ids) {
      if (typeof id === "string" && id) customers.add(id)
    }
  }
  return customers.size
}

/** The seller's active tiers as pricing channels; `null` when there are none. */
export function channelsFromTiers(tiers: CustomerTierRecord[]): ChannelSummary | null {
  const active = tiers.filter((tier) => tier.active !== false)
  if (active.length === 0) return null
  return {
    channels: active.map((tier) => ({
      key: tier.tier_type ?? tier.id ?? "channel",
      label: tier.name ?? tier.tier_type ?? "channel",
    })),
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
