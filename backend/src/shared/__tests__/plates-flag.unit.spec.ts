import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"
import { requireFeatureFlagMiddleware } from "../runtime-module-gates"

/**
 * FF_PLATES_V1 gates what sellers are shown from the jurisdiction-rule store
 * (`/vendor/plates/*`). It must default off: the rules are seeded as drafts
 * and signed off through the admin routes, which this flag does not gate,
 * before a seller sees any of them. The route-level proof is in
 * src/api/vendor/plates/__tests__/routes.unit.spec.ts and, through the real
 * middleware chain, integration-tests/http/jurisdiction-rules-signoff.spec.ts.
 */
describe("FF_PLATES_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.PLATES_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_PLATES_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("PLATES_V1")).toBe(false)
    expect(featureFlagState.snapshot().PLATES_V1).toBe(false)

    for (const v of ["1", "TRUE", "yes", ""]) {
      process.env[ENV] = v
      expect(featureFlagState.isEnabled("PLATES_V1")).toBe(false)
    }

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("PLATES_V1")).toBe(true)
    expect(featureFlagState.snapshot().PLATES_V1).toBe(true)
  })

  it("off, the gate answers 404 feature_disabled naming the env var and never calls next", async () => {
    const json = jest.fn()
    const status = jest.fn(() => ({ json }))
    const next = jest.fn() as unknown as MedusaNextFunction
    await requireFeatureFlagMiddleware("PLATES_V1")(
      {} as MedusaRequest,
      { status } as unknown as MedusaResponse,
      next
    )
    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith({
      type: "feature_disabled",
      message: "Feature flag FF_PLATES_V1 is disabled",
    })
    expect(next).not.toHaveBeenCalled()
  })

  it("on, the gate calls next and answers nothing", async () => {
    process.env[ENV] = "true"
    const status = jest.fn()
    const next = jest.fn() as unknown as MedusaNextFunction
    await requireFeatureFlagMiddleware("PLATES_V1")({} as MedusaRequest, { status } as unknown as MedusaResponse, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })
})
