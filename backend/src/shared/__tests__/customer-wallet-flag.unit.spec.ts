import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../feature-flags"
import { requireFeatureFlagMiddleware } from "../runtime-module-gates"

/**
 * The customer wallet (/store/hawala wallet, deposit, withdraw, bank-accounts,
 * transactions) is a customer-held, ACH-funded balance. It must default off;
 * the route-level proof is in src/api/__tests__/nested-middleware-auth.unit.spec.ts.
 */
describe("FF_CUSTOMER_WALLET_V1", () => {
  const ENV = PHASE0_FEATURE_FLAGS.CUSTOMER_WALLET_V1

  afterEach(() => {
    delete process.env[ENV]
  })

  it("is registered under the documented env name", () => {
    expect(ENV).toBe("FF_CUSTOMER_WALLET_V1")
  })

  it("defaults off and only the literal string true enables it", () => {
    expect(featureFlagState.isEnabled("CUSTOMER_WALLET_V1")).toBe(false)
    expect(featureFlagState.snapshot().CUSTOMER_WALLET_V1).toBe(false)

    for (const v of ["1", "TRUE", "yes", ""]) {
      process.env[ENV] = v
      expect(featureFlagState.isEnabled("CUSTOMER_WALLET_V1")).toBe(false)
    }

    process.env[ENV] = "true"
    expect(featureFlagState.isEnabled("CUSTOMER_WALLET_V1")).toBe(true)
  })

  it("off, the gate answers 404 feature_disabled naming the env var and never calls next", async () => {
    const json = jest.fn()
    const status = jest.fn(() => ({ json }))
    const next = jest.fn() as unknown as MedusaNextFunction
    await requireFeatureFlagMiddleware("CUSTOMER_WALLET_V1")(
      {} as MedusaRequest,
      { status } as unknown as MedusaResponse,
      next
    )
    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith({
      type: "feature_disabled",
      message: "Feature flag FF_CUSTOMER_WALLET_V1 is disabled",
    })
    expect(next).not.toHaveBeenCalled()
  })
})
