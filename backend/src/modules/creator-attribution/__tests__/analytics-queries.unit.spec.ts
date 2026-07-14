import {
  creatorAttributionQuery,
  creatorByCampaignQuery,
  creatorTotalsQuery,
  mapCreatorTotals,
  mergeProductFunnel,
  productByDayQuery,
  productFunnelQuery,
  productOrdersQuery,
  rangeToWindow,
} from "../analytics-queries"

const NOW = new Date("2026-07-14T12:00:00.000Z")
const WINDOW = { from: new Date("2026-06-14T12:00:00.000Z"), to: NOW }

describe("rangeToWindow", () => {
  it("defaults to 30 days and clamps to [1, 365]", () => {
    expect(rangeToWindow(undefined, NOW).days).toBe(30)
    expect(rangeToWindow("abc", NOW).days).toBe(30)
    expect(rangeToWindow(0, NOW).days).toBe(1)
    expect(rangeToWindow(9999, NOW).days).toBe(365)
    const w = rangeToWindow(7, NOW)
    expect(w.to).toEqual(NOW)
    expect(NOW.getTime() - w.from.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

describe("product queries", () => {
  const ids = ["prod_1", "prod_2"]

  it("parameterizes product ids after the date bindings", () => {
    for (const build of [productFunnelQuery, productByDayQuery, productOrdersQuery]) {
      const q = build({ productIds: ids, window: WINDOW })
      expect(q.bindings).toEqual([WINDOW.from, WINDOW.to, "prod_1", "prod_2"])
      expect(q.sql).toContain("IN ($3, $4)")
      expect(q.sql).toContain("deleted_at IS NULL")
    }
  })

  it("orders query joins real orders and excludes canceled", () => {
    const q = productOrdersQuery({ productIds: ids, window: WINDOW })
    expect(q.sql).toContain('JOIN "order" o')
    expect(q.sql).toContain("o.canceled_at IS NULL")
  })
})

describe("mergeProductFunnel", () => {
  it("merges event and order rows, computes conversion, sorts by views", () => {
    const rows = mergeProductFunnel(
      [
        { product_id: "prod_1", views: "100", add_to_carts: "20" },
        { product_id: "prod_2", views: "10", add_to_carts: "1" },
      ],
      [{ product_id: "prod_1", orders: "5", units: "8", title: "Widget" }]
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      product_id: "prod_1",
      title: "Widget",
      views: 100,
      add_to_carts: 20,
      orders: 5,
      units: 8,
      conversion: 0.05,
    })
    expect(rows[1].conversion).toBe(0)
  })

  it("keeps order-only products with null conversion (no views)", () => {
    const rows = mergeProductFunnel(
      [],
      [{ product_id: "prod_9", orders: 2, units: 2, title: "X" }]
    )
    expect(rows[0].orders).toBe(2)
    expect(rows[0].conversion).toBeNull()
  })

  it("drops rows with empty product ids", () => {
    expect(mergeProductFunnel([{ product_id: "", views: 5 }], [])).toEqual([])
  })
})

describe("creator queries", () => {
  it("scope by creator id with date bindings", () => {
    for (const build of [creatorTotalsQuery, creatorByCampaignQuery, creatorAttributionQuery]) {
      const q = build({ creatorSellerId: "seller_1", window: WINDOW })
      expect(q.bindings).toEqual([WINDOW.from, WINDOW.to, "seller_1"])
      expect(q.sql).toContain("deleted_at IS NULL")
    }
  })

  it("attribution query excludes reversed and disqualified commissions", () => {
    const q = creatorAttributionQuery({ creatorSellerId: "s", window: WINDOW })
    expect(q.sql).toContain("NOT IN ('reversed', 'disqualified')")
    expect(q.sql).toContain("order_attribution")
  })
})

describe("mapCreatorTotals", () => {
  it("folds event counts and attribution into the DTO", () => {
    const totals = mapCreatorTotals(
      [
        { event_name: "creator_profile_view", count: "42" },
        { event_name: "creator_link_clicked", count: "7" },
        { event_name: "click_affiliate", count: 3 },
      ],
      [{ attributed_orders: "4", commission_cents: "12345" }]
    )
    expect(totals).toEqual({
      profile_views: 42,
      link_clicks: 7,
      affiliate_clicks: 3,
      attributed_orders: 4,
      commission_cents: 12345,
    })
  })

  it("zeroes everything when rows are empty", () => {
    expect(mapCreatorTotals([], [])).toEqual({
      profile_views: 0,
      link_clicks: 0,
      affiliate_clicks: 0,
      attributed_orders: 0,
      commission_cents: 0,
    })
  })
})
