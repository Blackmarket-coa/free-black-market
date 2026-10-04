import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"

/**
 * BMC Survival Programs Phase 1 (docs/BMC_SURVIVAL_PROGRAMS.md). Every
 * nonprofit-parity surface -- partner-org admin routes, the IRS ingest, the
 * 0% donation fee rule at the composition point, the direct-charge donation
 * path -- sits behind this flag. It must default off so a deploy with no env
 * set never publishes an org record, never represents a tax status and never
 * moves donor money before counsel clears L11, L24 and L25.
 */
describe("FF_NONPROFIT_PARITY_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_NONPROFIT_PARITY_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("NONPROFIT_PARITY_V1")).toBe(false)

    process.env[ENV] = "1"
    expect(featureFlagState.isEnabled("NONPROFIT_PARITY_V1")).toBe(false)

    process.env[ENV] = "TRUE"
    expect(featureFlagState.isEnabled("NONPROFIT_PARITY_V1")).toBe(false)

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("NONPROFIT_PARITY_V1")).toBe(true)
  })
})
