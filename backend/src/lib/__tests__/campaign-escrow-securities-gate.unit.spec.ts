import {
  SECURITIES_GATE_FLAG,
  SecuritiesGateError,
  assertBackingModeReleasable,
  isSecuritiesGateCleared,
} from "../campaign-escrow"

/**
 * `docs/REPO_CONSOLIDATION_REVIEW.md` §8 gates revenue-share cash-in on the
 * Reg CF work and says such gates are "not configuration toggles". Until
 * 2026-09-09 the only thing between a micro-investor's money and a campaign
 * escrow was `FBM_CAMPAIGN_ESCROW_LIVE`, which is exactly such a toggle and
 * did not distinguish backing modes. See docs/TRANSMUTATION_STRATEGY.md §7.1.
 */
describe("micro-investor securities gate", () => {
  afterEach(() => {
    delete process.env[SECURITIES_GATE_FLAG]
  })

  it("uses the documented env name and defaults closed", () => {
    expect(SECURITIES_GATE_FLAG).toBe("FBM_SECURITIES_GATE_CLEARED")
    expect(isSecuritiesGateCleared()).toBe(false)
  })

  it("never blocks a PRE_ORDER backing — a forward purchase of goods", () => {
    expect(() => assertBackingModeReleasable("PRE_ORDER")).not.toThrow()

    process.env[SECURITIES_GATE_FLAG] = "1"
    expect(() => assertBackingModeReleasable("PRE_ORDER")).not.toThrow()
  })

  it("blocks a MICRO_INVESTOR backing while the gate is unanswered", () => {
    expect(() => assertBackingModeReleasable("MICRO_INVESTOR")).toThrow(
      SecuritiesGateError
    )
  })

  it("is not opened by the escrow mechanism flag", () => {
    process.env.FBM_CAMPAIGN_ESCROW_LIVE = "1"
    try {
      expect(() => assertBackingModeReleasable("MICRO_INVESTOR")).toThrow(
        SecuritiesGateError
      )
    } finally {
      delete process.env.FBM_CAMPAIGN_ESCROW_LIVE
    }
  })

  it("opens only for the literal string 1", () => {
    process.env[SECURITIES_GATE_FLAG] = "true"
    expect(() => assertBackingModeReleasable("MICRO_INVESTOR")).toThrow(
      SecuritiesGateError
    )

    process.env[SECURITIES_GATE_FLAG] = "1"
    expect(() => assertBackingModeReleasable("MICRO_INVESTOR")).not.toThrow()
  })
})
