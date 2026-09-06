import {
  RELIABILITY_MIN_SAMPLE,
  STALE_UNFULFILLED_DAYS,
  channelsFromTiers,
  countWholesaleRelationships,
  summarizeCustomers,
  summarizeOrders,
  type SellerOrderRecord,
} from "../operating"

/**
 * The order and tier arithmetic behind `operating.orders_fulfilled`,
 * `operating.fulfillment_reliability`, `customers.*` and
 * `customers.wholesale_relationships`. These were constants until 2026-09-06
 * (`docs/CDFI_COOP_ROADMAP.md` §1a), so Q5, Q7 and Q13 could never finish and
 * packets printed `orders_fulfilled: 0` as a fact. Pure functions, like the
 * revenue reconciliation spec next door.
 */

const asOf = new Date("2026-07-01T00:00:00.000Z")
const daysAgo = (days: number) => new Date(asOf.getTime() - days * 86_400_000).toISOString()

let seq = 0
const order = (partial: Partial<SellerOrderRecord>): SellerOrderRecord => ({
  id: `order_${++seq}`,
  customer_id: "cus_1",
  created_at: daysAgo(60),
  canceled_at: null,
  status: "pending",
  fulfillment_status: "not_fulfilled",
  ...partial,
})

describe("summarizeOrders — fulfilled orders", () => {
  it("counts fulfilled, shipped and delivered orders and nothing partial", () => {
    const orders = [
      order({ fulfillment_status: "fulfilled" }),
      order({ fulfillment_status: "shipped" }),
      order({ fulfillment_status: "delivered" }),
      order({ fulfillment_status: "partially_fulfilled" }),
      order({ fulfillment_status: "partially_shipped" }),
      order({ fulfillment_status: "partially_delivered" }),
      order({ fulfillment_status: "not_fulfilled" }),
    ]
    expect(summarizeOrders(orders, asOf).orders_fulfilled).toBe(3)
  })

  it("never counts a canceled order as fulfilled, whichever column says so", () => {
    const orders = [
      order({ fulfillment_status: "shipped", canceled_at: daysAgo(1) }),
      order({ fulfillment_status: "delivered", status: "canceled" }),
      order({ fulfillment_status: "canceled" }),
    ]
    expect(summarizeOrders(orders, asOf).orders_fulfilled).toBe(0)
  })
})

describe("summarizeOrders — reliability", () => {
  it("is null with fewer decided orders than the minimum sample", () => {
    const orders = Array.from({ length: RELIABILITY_MIN_SAMPLE - 1 }, () =>
      order({ fulfillment_status: "delivered" })
    )
    expect(summarizeOrders(orders, asOf).fulfillment_reliability).toBeNull()
  })

  it("is fulfilled ÷ (fulfilled + canceled + stale unfulfilled)", () => {
    const orders = [
      order({ fulfillment_status: "delivered" }),
      order({ fulfillment_status: "shipped" }),
      order({ fulfillment_status: "fulfilled" }),
      order({ fulfillment_status: "not_fulfilled", canceled_at: daysAgo(2) }),
      // Unfulfilled past the grace window: a failure.
      order({ fulfillment_status: "not_fulfilled", created_at: daysAgo(STALE_UNFULFILLED_DAYS) }),
    ]
    expect(summarizeOrders(orders, asOf)).toEqual({
      orders_fulfilled: 3,
      fulfillment_reliability: 0.6,
    })
  })

  it("leaves young unfulfilled and partially shipped orders undecided", () => {
    const decided = Array.from({ length: RELIABILITY_MIN_SAMPLE }, () =>
      order({ fulfillment_status: "delivered" })
    )
    const undecided = [
      order({ fulfillment_status: "not_fulfilled", created_at: daysAgo(STALE_UNFULFILLED_DAYS - 1) }),
      order({ fulfillment_status: "partially_fulfilled", created_at: daysAgo(3) }),
      order({ fulfillment_status: "partially_shipped", created_at: daysAgo(400) }),
      order({ fulfillment_status: "partially_delivered", created_at: daysAgo(400) }),
    ]
    expect(summarizeOrders([...decided, ...undecided], asOf).fulfillment_reliability).toBe(1)
  })

  it("treats a missing fulfillment status as unfulfilled", () => {
    const orders = [
      ...Array.from({ length: RELIABILITY_MIN_SAMPLE - 1 }, () => order({ fulfillment_status: "shipped" })),
      order({ fulfillment_status: null, created_at: daysAgo(STALE_UNFULFILLED_DAYS + 5) }),
    ]
    expect(summarizeOrders(orders, asOf).fulfillment_reliability).toBe(0.8)
  })
})

describe("summarizeCustomers", () => {
  it("counts distinct and repeat buyers over uncanceled orders only", () => {
    const orders = [
      order({ customer_id: "cus_a" }),
      order({ customer_id: "cus_a" }),
      order({ customer_id: "cus_b" }),
      order({ customer_id: "cus_b", canceled_at: daysAgo(1) }),
      order({ customer_id: "cus_c", status: "canceled" }),
      order({ customer_id: null }),
    ]
    expect(summarizeCustomers(orders)).toEqual({
      distinct_customers: 2,
      repeat_customers: 1,
      repeat_rate: 0.5,
    })
  })

  it("has a null repeat rate with no customers", () => {
    expect(summarizeCustomers([])).toEqual({
      distinct_customers: 0,
      repeat_customers: 0,
      repeat_rate: null,
    })
  })
})

describe("countWholesaleRelationships", () => {
  it("counts distinct customers across active WHOLESALE tiers, not tiers", () => {
    const tiers = [
      { tier_type: "WHOLESALE", active: true, customer_ids: ["cus_1", "cus_2"] },
      { tier_type: "WHOLESALE", active: true, customer_ids: ["cus_2", "cus_3", ""] },
      { tier_type: "WHOLESALE", active: false, customer_ids: ["cus_9"] },
      { tier_type: "PREFERRED", active: true, customer_ids: ["cus_4"] },
      { tier_type: "WHOLESALE", active: true, customer_ids: "not-an-array" },
      { tier_type: "WHOLESALE", customer_ids: null },
    ]
    expect(countWholesaleRelationships(tiers)).toBe(3)
  })
})

describe("channelsFromTiers", () => {
  it("is null with no active tiers", () => {
    expect(channelsFromTiers([])).toBeNull()
    expect(channelsFromTiers([{ tier_type: "WHOLESALE", active: false }])).toBeNull()
  })

  it("maps active tiers to channel keys and labels", () => {
    expect(
      channelsFromTiers([
        { id: "tier_1", tier_type: "WHOLESALE", name: "Garden centers", active: true },
        { id: "tier_2", tier_type: null, name: null },
      ])
    ).toEqual({
      channels: [
        { key: "WHOLESALE", label: "Garden centers" },
        { key: "tier_2", label: "channel" },
      ],
    })
  })
})
