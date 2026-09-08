import type {
  VendorSubstrate,
  RevenueSummary,
  OperatingHistory,
  CustomerRecord,
  ReputationSummary,
  InventoryValuation,
  ProductionSummary,
  VaultSummary,
  FundsSummary,
  PermitsSummary,
  PermitStanding,
} from "../types"

/**
 * Aggregate several members' substrates into ONE synthetic substrate for a
 * collective quest.
 *
 * The whole point: a collective quest is just "combine consenting members'
 * records, then run the SAME generic engine on the result." No collective-
 * specific evaluation code — `evaluateQuest` and `buildPacketExport` work
 * unchanged on the aggregate. The caller is responsible for passing ONLY
 * consenting members' substrates (see the collective service / routes); this
 * function does not know about consent and never fetches data itself.
 *
 * Universal fields sum (revenue, listings, orders, customers) or take the
 * strongest signal (oldest tenure, min fulfillment reliability, min trust).
 * Domain fields union across members. `collective.member_count` lets a
 * collective definition gate on group size.
 */
export function aggregateSubstrates(
  substrates: VendorSubstrate[],
  memberIds: string[],
  opts: { generatedAt?: string } = {}
): VendorSubstrate {
  const generated_at = opts.generatedAt ?? substrates[0]?.generated_at ?? ""

  return {
    seller_id: `collective:${memberIds.join(",")}`,
    generated_at,
    revenue: aggregateRevenue(substrates.map((s) => s.revenue)),
    operating: aggregateOperating(substrates.map((s) => s.operating)),
    customers: aggregateCustomers(substrates.map((s) => s.customers)),
    reputation: aggregateReputation(substrates.map((s) => s.reputation)),
    inventory: aggregateInventory(substrates.map((s) => s.inventory)),
    production: aggregateProduction(substrates.map((s) => s.production)),
    channels: unionChannels(substrates),
    documents: unionDocuments(substrates.map((s) => s.documents)),
    funds: aggregateFunds(substrates.map((s) => s.funds)),
    permits: aggregatePermits(substrates.map((s) => s.permits)),
    collective: { member_count: substrates.length, member_ids: memberIds },
  }
}

/**
 * Sum the members' fund portfolios. Null when no member has one, so a
 * collective of vendors without fund accounting reads "unavailable" exactly as
 * an individual would. Cents add across members because each member's figures
 * were already derived from their own ledger — this sums snapshots, it does not
 * re-derive them.
 */
function aggregateFunds(items: (FundsSummary | null)[]): FundsSummary | null {
  const present = items.filter((f): f is FundsSummary => f != null)
  if (present.length === 0) return null
  return {
    fund_count: sum(present.map((f) => f.fund_count)),
    currency_code: present[0].currency_code,
    awarded_cents: sum(present.map((f) => f.awarded_cents)),
    received_cents: sum(present.map((f) => f.received_cents)),
    spent_cents: sum(present.map((f) => f.spent_cents)),
    cash_available_cents: sum(present.map((f) => f.cash_available_cents)),
    violation_count: sum(present.map((f) => f.violation_count)),
  }
}

/**
 * Combine members' self-declared permit standings.
 *
 * Permits do NOT sum. A co-op does not hold its members' cottage-food permits —
 * each member holds their own — so the only honest combined reading is the
 * conservative one: the collective is no better off than its worst member.
 * Status takes the worst across members, and the expiry reported is the
 * soonest, because that is the date the collective actually has to act on.
 *
 * `unset` ranks worse than `ok` but better than a lapse: a member who never
 * declared anything is an unknown, not a known failure, and the two should not
 * read alike. `operation_type` is null unless every member declared the same
 * one — a mixed collective has no single operation, and naming one member's
 * would be a fabrication.
 *
 * Null when no member has a profile, so a collective of vendors without
 * cottage-food reads "unavailable" exactly as an individual would.
 */
const PERMIT_STATUS_SEVERITY: Record<PermitStanding["status"], number> = {
  ok: 0,
  unset: 1,
  expiring_soon: 2,
  expired: 3,
}

function worstStanding(items: PermitStanding[]): PermitStanding {
  const worst = items.reduce((a, b) =>
    PERMIT_STATUS_SEVERITY[b.status] > PERMIT_STATUS_SEVERITY[a.status] ? b : a
  )
  // The soonest real expiry across members, independent of which row was worst:
  // a collective acts on the next date that lapses, not on the worst status's.
  const dated = items.filter((i) => i.days_until != null)
  if (dated.length === 0) return { ...worst, expires_at: null, days_until: null }
  const soonest = dated.reduce((a, b) =>
    (b.days_until as number) < (a.days_until as number) ? b : a
  )
  return {
    status: worst.status,
    expires_at: soonest.expires_at,
    days_until: soonest.days_until,
  }
}

function aggregatePermits(
  items: (PermitsSummary | null)[]
): PermitsSummary | null {
  const present = items.filter((p): p is PermitsSummary => p != null)
  if (present.length === 0) return null

  const types = new Set(present.map((p) => p.operation_type))

  return {
    operation_type: types.size === 1 ? present[0].operation_type : null,
    permit: worstStanding(present.map((p) => p.permit)),
    food_handler: worstStanding(present.map((p) => p.food_handler)),
    advisory_count: sum(present.map((p) => p.advisory_count)),
  }
}

function aggregateRevenue(items: RevenueSummary[]): RevenueSummary {
  const currency = items[0]?.currency ?? "usd"
  const monthly = new Map<string, number>()
  for (const r of items) {
    for (const m of r.monthly) monthly.set(m.month, (monthly.get(m.month) ?? 0) + m.revenue)
  }
  return {
    currency,
    lifetime_revenue: round2(sum(items.map((r) => r.lifetime_revenue))),
    last_30d_revenue: round2(sum(items.map((r) => r.last_30d_revenue))),
    avg_daily_revenue: round2(sum(items.map((r) => r.avg_daily_revenue))),
    monthly: [...monthly.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, revenue]) => ({ month, revenue: round2(revenue) })),
    source: "aggregate:hawala-ledger:CREDIT+PURCHASE",
  }
}

function aggregateOperating(items: OperatingHistory[]): OperatingHistory {
  // Oldest account anchors tenure; reliability is the group's weakest link.
  const created = items
    .map((o) => o.account_created_at)
    .filter(Boolean)
    .sort() as string[]
  const reliabilities = items
    .map((o) => o.fulfillment_reliability)
    .filter((v): v is number => v != null)
  return {
    account_created_at: created[0] ?? null,
    account_age_days: Math.max(0, ...items.map((o) => o.account_age_days)),
    months_active: Math.max(0, ...items.map((o) => o.months_active)),
    listing_count: sum(items.map((o) => o.listing_count)),
    orders_fulfilled: sum(items.map((o) => o.orders_fulfilled)),
    fulfillment_reliability: reliabilities.length ? Math.min(...reliabilities) : null,
  }
}

function aggregateCustomers(items: CustomerRecord[]): CustomerRecord {
  const distinct = sum(items.map((c) => c.distinct_customers))
  const repeat = sum(items.map((c) => c.repeat_customers))
  return {
    distinct_customers: distinct,
    repeat_customers: repeat,
    repeat_rate: distinct > 0 ? round2(repeat / distinct) : null,
    wholesale_relationships: sum(items.map((c) => c.wholesale_relationships)),
  }
}

function aggregateReputation(items: ReputationSummary[]): ReputationSummary {
  const trusts = items.map((r) => r.trust_score).filter((v): v is number => v != null)
  return {
    // Weakest-link trust for the group; XP + credentials sum; disputes sum.
    trust_score: trusts.length ? Math.min(...trusts) : null,
    tier: null,
    total_xp: sum(items.map((r) => r.total_xp)),
    dispute_count: sum(items.map((r) => r.dispute_count)),
    verified_credentials: sum(items.map((r) => r.verified_credentials)),
  }
}

function aggregateInventory(items: (InventoryValuation | null)[]): InventoryValuation | null {
  const present = items.filter((v): v is InventoryValuation => v != null)
  if (!present.length) return null
  const costs = present.map((v) => v.cost_value).filter((v): v is number => v != null)
  return {
    on_hand_units: sum(present.map((v) => v.on_hand_units)),
    retail_value: round2(sum(present.map((v) => v.retail_value))),
    cost_value: costs.length ? round2(sum(costs)) : null,
  }
}

function aggregateProduction(items: (ProductionSummary | null)[]): ProductionSummary | null {
  const present = items.filter((v): v is ProductionSummary => v != null)
  if (!present.length) return null
  return {
    batch_count: sum(present.map((v) => v.batch_count)),
    total_started: sum(present.map((v) => v.total_started)),
    total_yield: sum(present.map((v) => v.total_yield)),
    methods: [...new Set(present.flatMap((v) => v.methods))],
  }
}

function unionChannels(substrates: VendorSubstrate[]): VendorSubstrate["channels"] {
  const present = substrates.map((s) => s.channels).filter(Boolean)
  if (!present.length) return null
  const seen = new Map<string, { key: string; label: string }>()
  for (const c of present) for (const ch of c!.channels) seen.set(ch.key, ch)
  return { channels: [...seen.values()] }
}

function unionDocuments(items: (VaultSummary | null)[]): VaultSummary | null {
  const present = items.filter((v): v is VaultSummary => v != null)
  if (!present.length) return null
  return { documents: present.flatMap((v) => v.documents) }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
