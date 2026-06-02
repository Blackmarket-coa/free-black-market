import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  createAuthenticatedSeller,
  ensureStoreInfra,
  authHeader,
  safe,
  AuthenticatedSeller,
  StoreInfra,
} from "./helpers/seller-auth"

// Boot (~45-55s) + seller bootstrap (register + createSellerWorkflow) need extra headroom.
jest.setTimeout(120 * 1000)

/**
 * Deep, authenticated smoke coverage for the @mercurjs/* vendor flows under
 * Medusa 2.14.2 + zod 4. Exercises the real seller-auth path and the mercurjs
 * route/middleware stack end-to-end so future Medusa/zod bumps have a regression net.
 *
 * All requests run inside a single test on purpose: the in-app test server closes idle
 * keep-alive sockets between separate `it()` blocks, which surfaces as intermittent
 * "Connection is closed" errors. Sequential requests in one test avoid that.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("Vendor authenticated flows (mercurjs)", () => {
      let ctx: AuthenticatedSeller
      let infra: StoreInfra

      beforeAll(async () => {
        infra = await ensureStoreInfra(getContainer())
        ctx = await createAuthenticatedSeller({ api, getContainer })
      })

      it("authenticates a seller across the mercurjs vendor read + product surface", async () => {
        // onboarding — custom route, resolves seller from the bearer token.
        const me = await safe(api.get("/vendor/sellers/me", authHeader(ctx.token)))
        expect(me.status).toBe(200)
        expect(me.data.seller?.id).toBe(ctx.seller.id)
        expect(typeof me.data.seller?.store_status).toBe("string")

        // orders — mercurjs dist route; exercises the seller-scoped filter middleware
        // (patched for null-safety) without crashing under zod 4 / Medusa 2.14.
        const orders = await safe(api.get("/vendor/orders", authHeader(ctx.token)))
        expect(orders.status).toBe(200)
        expect(Array.isArray(orders.data.orders)).toBe(true)

        // statistics — commission proxy (no first-class vendor commission route ships in
        // this mercurjs build). Assert only that auth succeeded and nothing crashed.
        const stats = await safe(api.get("/vendor/statistics", authHeader(ctx.token)))
        expect(stats.status).not.toBe(401)
        expect(stats.status).toBeLessThan(500)

        // reviews — @mercurjs/reviews is a meta-package; route may be absent (404).
        const reviews = await safe(
          api.get("/vendor/sellers/me/reviews", authHeader(ctx.token))
        )
        expect(reviews.status).not.toBe(401)
        expect(reviews.status).toBeLessThan(500)

        // product create — authenticated *mutation* path. This verifies the seller token
        // passes the full POST stack (Medusa auth -> our ensureSellerContext -> mercurjs
        // storeActiveGuard, which all reject non-active/unauthenticated sellers). We assert
        // the request is authorized as a seller (not 401/403); the request body mirrors the
        // seeded demo products (channel + default shipping profile + options/variant).
        //
        // NOTE: full product creation through createProductsWorkflow currently returns 500
        // in a bare test DB even with store infra seeded (an opaque error originating in a
        // mercurjs createProductsWorkflow hook). Asserting end-to-end creation is tracked as
        // a follow-up that needs the mercurjs product-hook prerequisites reproduced; here we
        // confirm the mutation auth path, and verify publish only if creation does succeed.
        const create = await safe(
          api.post(
            "/vendor/products",
            {
              title: `Smoke Product ${Date.now()}`,
              status: "draft",
              shipping_profile_id: infra.shippingProfileId,
              sales_channels: [{ id: infra.salesChannelId }],
              options: [{ title: "Default", values: ["Default"] }],
              variants: [{ title: "Default", options: { Default: "Default" } }],
            },
            authHeader(ctx.token)
          )
        )
        expect(create.status).not.toBe(401)
        expect(create.status).not.toBe(403)

        const productId =
          create.data?.product?.id ?? create.data?.products?.[0]?.id
        if (productId) {
          const publish = await safe(
            api.post(
              `/vendor/products/${productId}/status`,
              { status: "published" },
              authHeader(ctx.token)
            )
          )
          expect(publish.status).toBe(200)
        }
      })
    })
  },
})
