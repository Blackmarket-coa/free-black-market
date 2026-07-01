import type { VendorSubstrate } from "../types"

/**
 * Build a synthetic substrate for engine tests. Universal fields have sensible
 * defaults; domain fields default to `null` so the DEFAULT test vendor is a
 * universal-only (service/practitioner) vendor — the shape we most need to keep
 * first-class. Pass overrides to add inventory/production/etc.
 */
export function makeSubstrate(overrides: Partial<VendorSubstrate> = {}): VendorSubstrate {
  return {
    seller_id: "sel_test",
    generated_at: "2026-07-01T00:00:00.000Z",
    revenue: {
      currency: "usd",
      lifetime_revenue: 0,
      last_30d_revenue: 0,
      avg_daily_revenue: 0,
      monthly: [],
      source: "hawala-ledger:CREDIT+PURCHASE",
    },
    operating: {
      account_created_at: "2026-01-01T00:00:00.000Z",
      account_age_days: 0,
      months_active: 0,
      listing_count: 0,
      orders_fulfilled: 0,
      fulfillment_reliability: null,
    },
    customers: {
      distinct_customers: 0,
      repeat_customers: 0,
      repeat_rate: null,
      wholesale_relationships: 0,
    },
    reputation: {
      trust_score: null,
      tier: null,
      total_xp: 0,
      dispute_count: 0,
      verified_credentials: 0,
    },
    inventory: null,
    production: null,
    channels: null,
    documents: null,
    ...overrides,
  }
}

/** A well-established nursery vendor with the full physical-goods substrate. */
export function makeEstablishedNursery(): VendorSubstrate {
  return makeSubstrate({
    revenue: {
      currency: "usd",
      lifetime_revenue: 25_000,
      last_30d_revenue: 3_000,
      avg_daily_revenue: 70,
      monthly: Array.from({ length: 12 }, (_, i) => ({
        month: `2025-${String(i + 1).padStart(2, "0")}`,
        revenue: 2000,
      })),
      source: "hawala-ledger:CREDIT+PURCHASE",
    },
    operating: {
      account_created_at: "2025-01-01T00:00:00.000Z",
      account_age_days: 540,
      months_active: 18,
      listing_count: 40,
      orders_fulfilled: 300,
      fulfillment_reliability: 0.98,
    },
    customers: {
      distinct_customers: 120,
      repeat_customers: 45,
      repeat_rate: 0.375,
      wholesale_relationships: 3,
    },
    inventory: { on_hand_units: 800, retail_value: 9_600, cost_value: 3_200 },
    production: {
      batch_count: 22,
      total_started: 1500,
      total_yield: 1200,
      methods: ["cutting", "division", "seed"],
    },
    channels: { channels: [{ key: "apothecary", label: "Apothecary" }] },
    documents: {
      documents: [
        { id: "d1", doc_type: "lease", label: "Land lease", verified: true, expires_at: null },
      ],
    },
  })
}
