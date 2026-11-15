import { knex } from "@medusajs/framework/mikro-orm/knex"
import {
  creatorAttributionQuery,
  creatorByCampaignQuery,
  creatorByDayQuery,
  creatorTotalsQuery,
  mapCreatorTotals,
  mergeProductFunnel,
  productByDayQuery,
  productFunnelQuery,
  productOrdersQuery,
  productOrdersTotalQuery,
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

/**
 * Routes run these through knex's `raw`, which binds `?` placeholders and
 * throws "Expected N bindings, saw M" when the count is off. Running every
 * builder through knex's own binding pass is the check the old spec lacked:
 * it asserted the `$3, $4` text, so it pinned the defect that made both
 * dashboards answer 500 (SD-74). No database: `toSQL()` only binds.
 */
const pg = knex({ client: "pg" })
const bind = (q: { sql: string; bindings: unknown[] }) =>
  pg.raw(q.sql, q.bindings as never).toSQL().toNative()

describe("product queries", () => {
  const ids = ["prod_1", "prod_2"]

  it("bind under knex's raw: dates, then the product ids as one ANY(?) list", () => {
    for (const build of [productFunnelQuery, productByDayQuery, productOrdersQuery, productOrdersTotalQuery]) {
      const q = build({ productIds: ids, window: WINDOW })
      expect(q.bindings).toEqual([WINDOW.from, WINDOW.to, ids])
      const native = bind(q)
      expect(native.bindings).toEqual([WINDOW.from, WINDOW.to, ids])
      expect(native.sql).toMatch(/>= \$1 AND [a-z_.]+ <= \$2/)
      expect(native.sql).toContain("= ANY($3)")
      expect(q.sql).toContain("deleted_at IS NULL")
    }
  })

  it("orders query reads quantities from order_item at the order's version, and counts only placed orders", () => {
    const q = productOrdersQuery({ productIds: ids, window: WINDOW })
    expect(q.sql).toContain("FROM order_item oi")
    expect(q.sql).toContain("oi.version = o.version")
    expect(q.sql).toContain("SUM(oi.quantity)")
    expect(q.sql).not.toMatch(/oli\.(quantity|order_id|total)\b/)
    expect(q.sql).toContain("o.canceled_at IS NULL")
    expect(q.sql).toContain("o.is_draft_order = false")
  })

  it("the funnel total counts distinct orders across all the seller's products, not per product", () => {
    // Adding up the per-product COUNT(DISTINCT o.id) counted an order once per
    // product in it. The behaviour is pinned on Postgres by
    // integration-tests/http/vendor-sales-analytics.spec.ts; this pins the shape.
    const q = productOrdersTotalQuery({ productIds: ids, window: WINDOW })
    expect(q.sql).toContain("COUNT(DISTINCT o.id)")
    expect(q.sql).not.toMatch(/GROUP BY/i)
    expect(q.sql).toContain("oi.version = o.version")
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
  it("bind under knex's raw", () => {
    for (const build of [creatorTotalsQuery, creatorByDayQuery, creatorByCampaignQuery, creatorAttributionQuery]) {
      const native = bind(build({ creatorSellerId: "seller_1", window: WINDOW }))
      expect(native.bindings).toEqual([WINDOW.from, WINDOW.to, "seller_1"])
      expect(native.sql).toContain("creator_seller_id = $3")
    }
  })

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
