import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * Wellness sale KARMA (`class_sold_out`, `membership_first_signup` from
 * `subscribers/wellness-order-placed`) is PRODUCER-track XP whose start
 * docs/F7_FLAT_PAYOUT_INVENTORY.md §10 item 8 reserves to the operator
 * (SD-52). It must default off; only the literal string "true" enables it.
 */
describe("FF_WELLNESS_SALE_KARMA_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.WELLNESS_SALE_KARMA_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_WELLNESS_SALE_KARMA_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("WELLNESS_SALE_KARMA_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("WELLNESS_SALE_KARMA_V1")).toBe(false)

    process.env[ENV] = "TRUE"
    expect(featureFlagState.isEnabled("WELLNESS_SALE_KARMA_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("WELLNESS_SALE_KARMA_V1")).toBe(true)
  })

  it("is included in the snapshot, off by default", () => {
    expect(featureFlagState.snapshot().WELLNESS_SALE_KARMA_V1).toBe(false)
  })
})
