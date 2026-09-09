import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * hawala-ledger `InvestmentPool` / `Investment` are quiescent under Posture A
 * unless and until an offering is structured under a securities exemption
 * (docs/POSTURE_A_COMPLIANCE.md § "Existing models documented as quiescent").
 *
 * Until 2026-09-09 the pool and investment routes were live behind auth alone:
 * a seller could create an ACTIVE pool with a chosen ROI type, and a customer
 * could fund one from an ACH-topped wallet. They now sit behind this flag,
 * which must default off so that a deploy with no env set never offers a
 * retail investment. See docs/TRANSMUTATION_STRATEGY.md §7.2.
 */
describe("FF_INVESTMENT_POOLS_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_INVESTMENT_POOLS_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("INVESTMENT_POOLS_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("INVESTMENT_POOLS_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("INVESTMENT_POOLS_V1")).toBe(true)
  })
})
