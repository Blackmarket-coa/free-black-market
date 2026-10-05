import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"
import { allAccessPlanEnabled } from "../../modules/vendor-plan/catalog"

/**
 * FF_ALL_ACCESS_PLAN_V1 (Black Mask F8) swaps the self-serve plan ladder for
 * free + the $10 all-access plan. It must default off, and the catalog's own
 * reader must be the registry's reader, not a second env parse.
 */
describe("FF_ALL_ACCESS_PLAN_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.ALL_ACCESS_PLAN_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_ALL_ACCESS_PLAN_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("ALL_ACCESS_PLAN_V1")).toBe(false)
    expect(allAccessPlanEnabled()).toBe(false)

    process.env[ENV] = "1"
    expect(allAccessPlanEnabled()).toBe(false)

    process.env[ENV] = "TRUE"
    expect(allAccessPlanEnabled()).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("ALL_ACCESS_PLAN_V1")).toBe(true)
    expect(allAccessPlanEnabled()).toBe(true)
  })
})
