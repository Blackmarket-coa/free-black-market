import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  createAuthenticatedSeller,
  authHeader,
  safe,
} from "./helpers/seller-auth"

// Raised from 60s: the billing-plan cases below bootstrap real sellers, and
// boot (~45-55s) plus seller bootstrap needs the same headroom that
// `vendor-quest-flows.spec.ts` documents.
jest.setTimeout(120 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    // `feature-flags.ts` reads the FF_-prefixed names; the unprefixed ones
    // below are inert and kept only so the pre-existing 401 assertions read
    // as originally written (they 401 at `authenticate` before ever reaching
    // the flag gate, so the flag state never mattered to them). The
    // billing-plan cases DO reach the flag gate, and need it genuinely on —
    // otherwise they'd see the kill switch's 404 instead of the paywall's 402.
    INVOICING_V1: "true",
    POS_V1: "true",
    FF_INVOICING_V1: "true",
    FF_POS_V1: "true",
  },
  testSuite: ({ api, getContainer }) => {
    describe("Phase 3 vendor operations authz smoke", () => {
      it("requires seller auth for farm harvest creation", async () => {
        const response = await api
          .post("/vendor/farm/harvests", {
            crop_name: "Tomatoes",
            year: 2026,
          })
          .catch((e) => e.response)

        expect(response.status).toBe(401)
      })

      it("requires seller auth for invoicing endpoints", async () => {
        const listResponse = await api
          .get("/vendor/invoices")
          .catch((e) => e.response)
        expect(listResponse.status).toBe(401)

        const createResponse = await api
          .post("/vendor/invoices", {
            order_id: "ord_test",
            total: 1000,
            currency_code: "USD",
            status: "draft",
          })
          .catch((e) => e.response)
        expect(createResponse.status).toBe(401)
      })

      it("requires seller auth for POS endpoints", async () => {
        const configResponse = await api
          .get("/vendor/pos/config")
          .catch((e) => e.response)
        expect(configResponse.status).toBe(401)

        const checkoutResponse = await api
          .post("/vendor/pos/checkout", {
            payee_vendor_id: "seller_receiver",
            amount: 120,
            payment_method: "manual",
          })
          .catch((e) => e.response)
        expect(checkoutResponse.status).toBe(401)
      })

      describe("billing-plan gate", () => {
        it("402s a free-plan seller on a paid surface, distinctly from 401 and 404", async () => {
          // End-to-end cover for `requirePlanFeature`. The route's feature flag
          // is ON (see env above), so a 404 here would mean the kill switch
          // fired instead of the paywall, and a 401 would mean auth broke —
          // the three have to stay distinguishable for the panel to react.
          const seller = await createAuthenticatedSeller({
            api,
            getContainer,
            storeName: "Free Plan Vendor",
            planCode: "free",
          })

          const res = await safe(
            api.get("/vendor/invoices", authHeader(seller.token))
          )

          expect(res.status).toBe(402)
          expect(res.data).toMatchObject({
            code: "plan_upgrade_required",
            required_feature: "vendor.invoicing",
            current_plan: "free",
          })
        })

        it("lets an entitled seller through the same route", async () => {
          const seller = await createAuthenticatedSeller({
            api,
            getContainer,
            storeName: "Paid Plan Vendor",
            planCode: "pro",
          })

          const res = await safe(
            api.get("/vendor/invoices", authHeader(seller.token))
          )

          // Asserts the gate opened, not what the invoices handler returns —
          // pinning an exact 200 here would couple this case to that route's
          // behaviour rather than to the thing under test.
          expect(res.status).not.toBe(402)
          expect(res.data?.code).not.toBe("plan_upgrade_required")
        })
      })
    })
  },
})
