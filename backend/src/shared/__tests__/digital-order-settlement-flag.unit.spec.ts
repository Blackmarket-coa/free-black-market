import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * SD-48: a digital-product checkout captures the card and links the order to
 * its seller only behind this flag. It moves money (a capture), so it must
 * default off and only the literal string "true" may turn it on.
 */
describe("FF_DIGITAL_ORDER_SETTLEMENT_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.DIGITAL_ORDER_SETTLEMENT_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_DIGITAL_ORDER_SETTLEMENT_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("DIGITAL_ORDER_SETTLEMENT_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("DIGITAL_ORDER_SETTLEMENT_V1")).toBe(false)

    process.env[ENV] = "TRUE"
    expect(featureFlagState.isEnabled("DIGITAL_ORDER_SETTLEMENT_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("DIGITAL_ORDER_SETTLEMENT_V1")).toBe(true)
  })
})
