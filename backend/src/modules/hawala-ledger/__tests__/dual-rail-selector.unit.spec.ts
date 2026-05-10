import { selectSettlementRail } from "../dual-rail-selector"

const healthyHealth = {
  horizon_reachable: true,
  usdc_balance: 1_000_000,
  last_batch_status: "succeeded" as const,
}

describe("selectSettlementRail", () => {
  it("forces Stripe-ACH for non-USD/USDC currencies", () => {
    const result = selectSettlementRail({
      amount: 100,
      currency: "EUR",
      health: healthyHealth,
    })
    expect(result.rail).toBe("stripe_ach")
    expect(result.reasons.find((r) => r.check === "currency")?.outcome).toBe("fail")
  })

  it("forces Stripe-ACH below the minimum Stellar amount", () => {
    const result = selectSettlementRail({
      amount: 0.5,
      currency: "USD",
      health: healthyHealth,
    })
    expect(result.rail).toBe("stripe_ach")
    expect(result.reasons.find((r) => r.check === "amount_threshold")?.outcome).toBe("fail")
  })

  it("forces Stripe-ACH when Horizon is unreachable", () => {
    const result = selectSettlementRail({
      amount: 100,
      currency: "USDC",
      health: { ...healthyHealth, horizon_reachable: false },
    })
    expect(result.rail).toBe("stripe_ach")
    expect(result.reasons.find((r) => r.check === "horizon_reachable")?.outcome).toBe("fail")
  })

  it("forces Stripe-ACH when the last batch failed", () => {
    const result = selectSettlementRail({
      amount: 100,
      currency: "USDC",
      health: { ...healthyHealth, last_batch_status: "failed" },
    })
    expect(result.rail).toBe("stripe_ach")
    expect(result.reasons.find((r) => r.check === "last_batch_status")?.outcome).toBe("fail")
  })

  it("forces Stripe-ACH when bridge USDC liquidity is below the amount", () => {
    const result = selectSettlementRail({
      amount: 5_000,
      currency: "USDC",
      health: { ...healthyHealth, usdc_balance: 100 },
    })
    expect(result.rail).toBe("stripe_ach")
    expect(result.reasons.find((r) => r.check === "usdc_liquidity")?.outcome).toBe("fail")
  })

  it("picks Stellar-USDC when all checks pass", () => {
    const result = selectSettlementRail({
      amount: 100,
      currency: "USDC",
      health: healthyHealth,
    })
    expect(result.rail).toBe("stellar_usdc")
    expect(result.reasons.every((r) => r.outcome === "pass")).toBe(true)
  })

  it("honors operator forceRail override regardless of health", () => {
    const result = selectSettlementRail({
      amount: 100,
      currency: "EUR",
      health: { ...healthyHealth, horizon_reachable: false },
      forceRail: "stellar_usdc",
    })
    expect(result.rail).toBe("stellar_usdc")
    expect(result.reasons[0].check).toBe("force_rail")
  })
})
