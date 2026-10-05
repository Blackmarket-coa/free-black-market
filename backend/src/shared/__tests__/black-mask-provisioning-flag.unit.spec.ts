import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * The Black Mask provisioning channel (F3) sends customer-linked notices to a
 * separate service. It must default off; only the literal string "true"
 * enables it.
 */
describe("FF_BLACK_MASK_PROVISIONING_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_BLACK_MASK_PROVISIONING_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")).toBe(false)

    process.env[ENV] = "TRUE"
    expect(featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("BLACK_MASK_PROVISIONING_V1")).toBe(true)
  })

  it("is included in the snapshot, off by default", () => {
    expect(featureFlagState.snapshot().BLACK_MASK_PROVISIONING_V1).toBe(false)
  })
})
