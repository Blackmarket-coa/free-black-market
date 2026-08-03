import { computePluginRevenueShare } from "../plugin-revenue-share"

const base = {
  platformFeeCents: 300,
  pluginDeveloperPercent: 1,
  sellerSubtotalCents: 10_000,
  sellerId: "sel_vendor",
}

describe("computePluginRevenueShare", () => {
  it("pays the developer out of the platform fee", () => {
    const r = computePluginRevenueShare({
      ...base,
      plugins: [{ slug: "analytics", author_seller_id: "sel_dev" }],
    })

    expect(r.total_cents).toBe(100)
    expect(r.allocations).toEqual([
      { slug: "analytics", author_seller_id: "sel_dev", amount_cents: 100 },
    ])
    // Carved out, not added on: the platform's 300 becomes 200, and the
    // seller's payout is untouched.
    expect(r.platform_retained_cents).toBe(200)
  })

  it("never exceeds the platform fee", () => {
    // A misconfigured percentage costs the platform its fee; it must never
    // drive platform revenue negative or reach into the seller's payout.
    const r = computePluginRevenueShare({
      ...base,
      pluginDeveloperPercent: 50,
      plugins: [{ slug: "a", author_seller_id: "sel_dev" }],
    })

    expect(r.total_cents).toBe(300)
    expect(r.platform_retained_cents).toBe(0)
  })

  it("splits evenly between developers", () => {
    const r = computePluginRevenueShare({
      ...base,
      pluginDeveloperPercent: 2,
      plugins: [
        { slug: "a", author_seller_id: "sel_a" },
        { slug: "b", author_seller_id: "sel_b" },
      ],
    })

    expect(r.total_cents).toBe(200)
    expect(r.allocations.map((a) => a.amount_cents)).toEqual([100, 100])
  })

  it("allocates remainder cents so the split sums exactly", () => {
    // 100 / 3 does not divide; the allocations must still total 100, not 99.
    const r = computePluginRevenueShare({
      ...base,
      plugins: [
        { slug: "a", author_seller_id: "sel_a" },
        { slug: "b", author_seller_id: "sel_b" },
        { slug: "c", author_seller_id: "sel_c" },
      ],
    })

    expect(r.allocations.map((a) => a.amount_cents)).toEqual([34, 33, 33])
    expect(r.total_cents).toBe(100)
    expect(r.platform_retained_cents).toBe(200)
  })

  it("allocates the same way on a replay", () => {
    // A re-settled order must reproduce the ledger exactly, so the remainder
    // cannot depend on input ordering.
    const plugins = [
      { slug: "c", author_seller_id: "sel_c" },
      { slug: "a", author_seller_id: "sel_a" },
      { slug: "b", author_seller_id: "sel_b" },
    ]
    const first = computePluginRevenueShare({ ...base, plugins })
    const second = computePluginRevenueShare({
      ...base,
      plugins: [...plugins].reverse(),
    })

    expect(first.allocations).toEqual(second.allocations)
    expect(first.allocations[0].slug).toBe("a")
  })

  it("keeps a first-party plugin's slice with the platform", () => {
    // Redistributing it would mean installing one first-party plugin quietly
    // raised every other developer's cut.
    const r = computePluginRevenueShare({
      ...base,
      pluginDeveloperPercent: 2,
      plugins: [
        { slug: "first-party", author_seller_id: null },
        { slug: "third-party", author_seller_id: "sel_dev" },
      ],
    })

    expect(r.allocations).toHaveLength(1)
    expect(r.total_cents).toBe(200)
    expect(r.allocations[0].author_seller_id).toBe("sel_dev")
  })

  it("does not pay a vendor for their own plugin", () => {
    // A zero-net round trip that would still show as real ledger movement and
    // inflate that developer's earnings reporting.
    const r = computePluginRevenueShare({
      ...base,
      plugins: [{ slug: "mine", author_seller_id: "sel_vendor" }],
    })

    expect(r.allocations).toEqual([])
    expect(r.platform_retained_cents).toBe(300)
  })

  it("pays the others when only one plugin is the vendor's own", () => {
    const r = computePluginRevenueShare({
      ...base,
      plugins: [
        { slug: "mine", author_seller_id: "sel_vendor" },
        { slug: "theirs", author_seller_id: "sel_dev" },
      ],
    })

    expect(r.allocations).toHaveLength(1)
    expect(r.total_cents).toBe(100)
  })

  it("is a no-op with no plugins installed", () => {
    const r = computePluginRevenueShare({ ...base, plugins: [] })
    expect(r.total_cents).toBe(0)
    expect(r.platform_retained_cents).toBe(300)
  })

  it("is a no-op when the share is unconfigured", () => {
    // Default state today: the column exists and is 0.
    const r = computePluginRevenueShare({
      ...base,
      pluginDeveloperPercent: 0,
      plugins: [{ slug: "a", author_seller_id: "sel_dev" }],
    })
    expect(r.total_cents).toBe(0)
    expect(r.platform_retained_cents).toBe(300)
  })

  it("is a no-op when there is no platform fee to share", () => {
    // A seller on a 0% negotiated rate generates nothing to carve from.
    const r = computePluginRevenueShare({
      ...base,
      platformFeeCents: 0,
      plugins: [{ slug: "a", author_seller_id: "sel_dev" }],
    })
    expect(r.total_cents).toBe(0)
    expect(r.platform_retained_cents).toBe(0)
  })

  it("rejects a nonsense percentage rather than moving odd money", () => {
    for (const pct of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computePluginRevenueShare({
        ...base,
        pluginDeveloperPercent: pct,
        plugins: [{ slug: "a", author_seller_id: "sel_dev" }],
      })
      expect(r.total_cents).toBe(0)
      expect(r.platform_retained_cents).toBe(300)
    }
  })

  it("drops zero-value allocations rather than emitting empty transfers", () => {
    // Pool of 1 cent across 3 developers: one gets it, two get nothing, and
    // nothing is queued for them.
    const r = computePluginRevenueShare({
      platformFeeCents: 300,
      pluginDeveloperPercent: 0.01,
      sellerSubtotalCents: 10_000,
      sellerId: "sel_vendor",
      plugins: [
        { slug: "a", author_seller_id: "sel_a" },
        { slug: "b", author_seller_id: "sel_b" },
        { slug: "c", author_seller_id: "sel_c" },
      ],
    })

    expect(r.total_cents).toBe(1)
    expect(r.allocations).toEqual([
      { slug: "a", author_seller_id: "sel_a", amount_cents: 1 },
    ])
  })
})
