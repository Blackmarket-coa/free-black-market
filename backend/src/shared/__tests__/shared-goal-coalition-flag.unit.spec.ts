import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * Shared-goal Coalitions (Phase 1 item 3) extend collective-campaign with a
 * public fundraising surface, which is commercial co-venturer territory (L25).
 * The new routes and the storefront view sit behind this flag; it must default
 * off.
 */
describe("FF_SHARED_GOAL_COALITION_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.SHARED_GOAL_COALITION_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_SHARED_GOAL_COALITION_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("SHARED_GOAL_COALITION_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("SHARED_GOAL_COALITION_V1")).toBe(false)

    process.env[ENV] = "TRUE"
    expect(featureFlagState.isEnabled("SHARED_GOAL_COALITION_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("SHARED_GOAL_COALITION_V1")).toBe(true)
  })
})
