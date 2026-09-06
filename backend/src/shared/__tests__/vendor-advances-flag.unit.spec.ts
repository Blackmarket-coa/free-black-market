import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * hawala-ledger `VendorAdvance` is quiescent under Posture A pending legal
 * review (docs/POSTURE_A_COMPLIANCE.md). The advance routes and the panel
 * section sit behind this flag, which must default off so that a deploy
 * with no env set never offers cash advances.
 */
describe("FF_VENDOR_ADVANCES_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.VENDOR_ADVANCES_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_VENDOR_ADVANCES_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("VENDOR_ADVANCES_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("VENDOR_ADVANCES_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("VENDOR_ADVANCES_V1")).toBe(true)
  })
})
