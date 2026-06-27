import { computeNodeSplit, GROWER_SPLIT_CONFIG, PLATFORM_FEE } from "../grower-payout"

describe("grower-payout: computeNodeSplit", () => {
  it("splits a $100 node sale at 5% platform fee / 60% grower", () => {
    const r = computeNodeSplit(10000, 0.05, 0.6)
    expect(r.grossDollars).toBe(100)
    expect(r.platformFee).toBeCloseTo(5, 6)
    expect(r.net).toBeCloseTo(95, 6)
    expect(r.growerAmount).toBeCloseTo(57, 6)
    expect(r.hubAmount).toBe(38) // 95 - 57, rounded to cents
  })

  it("gives the hub nothing when the grower keeps 100% (hub_sc)", () => {
    const r = computeNodeSplit(10000, 0.05, 1.0)
    expect(r.hubAmount).toBe(0)
    expect(r.growerAmount).toBeCloseTo(95, 6)
  })

  it("rounds the hub amount to whole cents", () => {
    const r = computeNodeSplit(3333, 0.05, 0.62)
    // gross 33.33, fee 1.6665, net 31.6635, grower 19.63137, hub 12.03213 -> 12.03
    expect(r.hubAmount).toBe(12.03)
  })

  it("handles a zero-value line", () => {
    const r = computeNodeSplit(0, 0.05, 0.6)
    expect(r.grossDollars).toBe(0)
    expect(r.hubAmount).toBe(0)
  })

  it("keeps split config + platform fee constants in expected ranges", () => {
    expect(GROWER_SPLIT_CONFIG.hub_sc).toBe(1.0)
    expect(GROWER_SPLIT_CONFIG.node_nc_mtn).toBe(0.62)
    for (const v of Object.values(GROWER_SPLIT_CONFIG)) {
      expect(v).toBeGreaterThanOrEqual(0.6)
      expect(v).toBeLessThanOrEqual(1.0)
    }
    expect(PLATFORM_FEE).toBe(0.05)
  })
})
