import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * The F4 consumer-subscription lifecycle (grace → read-only, until-canceled)
 * changes what happens to a paying customer's access on cancel and on failed
 * payment. Every new transition sits behind this flag; it must default off.
 */
describe("FF_CONSUMER_SUBSCRIPTIONS_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_CONSUMER_SUBSCRIPTIONS_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")).toBe(false)

    process.env[ENV] = "TRUE"
    expect(featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")).toBe(true)
  })
})
