import { describe, it, expect } from "vitest"

import { buildPlatforms, priceForTargetTakeHome } from "../FeeBreakdown"

/**
 * The fee comparison is the platform's central marketing claim, so the two
 * things worth pinning down are (a) our own row reflects whatever rate the
 * backend reports rather than a hardcoded 3, and (b) the reverse
 * "what must I charge?" solver actually inverts each fee model.
 */
describe("buildPlatforms", () => {
  it("drives the BMC row from the supplied rate, not a hardcoded 3%", () => {
    const bmc = buildPlatforms(2.5).find((p) => p.name === "BMC")!

    expect(bmc.calcFees(100).total).toBeCloseTo(2.5, 10)
    // The bullet list is read by vendors deciding whether to join; a stale
    // literal there would be exactly the drift this change exists to prevent.
    expect(bmc.breakdown[0]).toBe("2.5% marketplace commission")
  })

  it("charges nothing beyond the commission", () => {
    const bmc = buildPlatforms(3).find((p) => p.name === "BMC")!
    const fees = bmc.calcFees(80)

    expect(fees.processing).toBe(0)
    expect(fees.ads).toBe(0)
    expect(fees.listing).toBe(0)
    expect(fees.fulfillment).toBe(0)
    expect(fees.total).toBeCloseTo(fees.commission, 10)
  })

  it("keeps every competitor in the comparison", () => {
    const names = buildPlatforms(3).map((p) => p.name)

    expect(names[0]).toBe("BMC")
    expect(names).toContain("Etsy")
    expect(names).toContain("Shopify")
    expect(names).toContain("Amazon FBA")
    expect(names).toHaveLength(7)
  })
})

describe("priceForTargetTakeHome", () => {
  const platforms = buildPlatforms(3)

  it("inverts every platform's fee model to within a cent", () => {
    for (const platform of platforms) {
      const price = priceForTargetTakeHome(platform, 75)
      expect(price, `${platform.name} should reach a $75 take-home`).not.toBeNull()

      const takeHome = price! - platform.calcFees(price!).total
      expect(takeHome, `${platform.name} round-trip`).toBeCloseTo(75, 2)
    }
  })

  it("solves the flat-commission case exactly", () => {
    // 3% commission: keeping $97 means listing at $100.
    const bmc = platforms.find((p) => p.name === "BMC")!
    expect(priceForTargetTakeHome(bmc, 97)).toBeCloseTo(100, 6)
  })

  it("requires a higher list price on an extractive platform than on BMC", () => {
    const bmc = platforms.find((p) => p.name === "BMC")!
    const etsy = platforms.find((p) => p.name === "Etsy")!

    expect(priceForTargetTakeHome(etsy, 50)!).toBeGreaterThan(
      priceForTargetTakeHome(bmc, 50)!
    )
  })

  it("handles Amazon's fee step at $50 without overshooting", () => {
    // The FBA per-unit fee jumps at a $50 list price, so the solver must not
    // assume a continuous model. Bracket a target that lands near the step.
    const amazon = platforms.find((p) => p.name === "Amazon FBA")!
    const price = priceForTargetTakeHome(amazon, 40)!

    expect(price - amazon.calcFees(price).total).toBeCloseTo(40, 2)
  })

  it("returns null when no price clears the target", () => {
    const impossible = {
      name: "All of it",
      color: "#000",
      icon: "x",
      breakdown: [],
      verdict: "",
      // Takes 100% of every sale — no list price ever leaves anything over.
      calcFees: (price: number) => ({
        commission: price,
        processing: 0,
        ads: 0,
        fulfillment: 0,
        listing: 0,
        other: 0,
        total: price,
      }),
    }

    expect(priceForTargetTakeHome(impossible, 10)).toBeNull()
  })

  it("treats a zero target as a zero price", () => {
    const bmc = platforms.find((p) => p.name === "BMC")!
    expect(priceForTargetTakeHome(bmc, 0)).toBeCloseTo(0, 6)
  })
})
