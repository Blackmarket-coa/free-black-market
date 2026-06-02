import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  createAuthenticatedSeller,
  authHeader,
  safe,
  AuthenticatedSeller,
} from "./helpers/seller-auth"

jest.setTimeout(120 * 1000)

/**
 * Regression net for the zod 4 idiom bug in the mercurjs vendor-promotions path-param
 * guards. The compiled guards read `result.error.errors`, which is `undefined` under
 * zod 4 (renamed to `.issues`), so 400 responses for an invalid rule_type lost their
 * `details` array. scripts/patch-mercurjs.js rewrites `.error.errors` -> `.error.issues`.
 *
 * This spec FAILS before that patch (details is undefined) and PASSES after it.
 * The endpoints are GET, which storeActiveGuard allows regardless of store_status, so an
 * authenticated seller reaches the guard.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("Vendor promotions path-param guards (zod 4)", () => {
      let ctx: AuthenticatedSeller

      beforeAll(async () => {
        ctx = await createAuthenticatedSeller({ api, getContainer })
      })

      // Both guard checks run in one test: the in-app server closes idle keep-alive
      // sockets between separate it() blocks ("Connection is closed"); sequential
      // requests in one test avoid that.
      it("invalid rule_type returns 400 with a populated details array (zod 4 .issues)", async () => {
        const attr = await safe(
          api.get(
            "/vendor/promotions/rule-attribute-options/not-a-real-rule",
            authHeader(ctx.token)
          )
        )
        expect(attr.status).toBe(400)
        expect(attr.data.error).toBe("Invalid path parameters")
        expect(Array.isArray(attr.data.details)).toBe(true)
        expect(attr.data.details.length).toBeGreaterThan(0)

        const value = await safe(
          api.get(
            "/vendor/promotions/rule-value-options/not-a-real-rule/attr_x",
            authHeader(ctx.token)
          )
        )
        expect(value.status).toBe(400)
        expect(value.data.error).toBe("Invalid path parameters")
        expect(Array.isArray(value.data.details)).toBe(true)
        expect(value.data.details.length).toBeGreaterThan(0)
      })
    })
  },
})
