import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    INVOICING_V1: "true",
    POS_V1: "true",
  },
  testSuite: ({ api }) => {
    describe("Phase 3 vendor operations authz smoke", () => {
      it("requires seller auth for farm harvest creation", async () => {
        const response = await api.post("/vendor/farm/harvests", {
          crop_name: "Tomatoes",
          year: 2026,
        })

        expect(response.status).toBe(401)
      })

      it("requires seller auth for invoicing endpoints", async () => {
        const listResponse = await api.get("/vendor/invoices")
        expect(listResponse.status).toBe(401)

        const createResponse = await api.post("/vendor/invoices", {
          order_id: "ord_test",
          total: 1000,
          currency_code: "USD",
          status: "draft",
        })
        expect(createResponse.status).toBe(401)
      })

      it("requires seller auth for POS endpoints", async () => {
        const configResponse = await api.get("/vendor/pos/config")
        expect(configResponse.status).toBe(401)

        const checkoutResponse = await api.post("/vendor/pos/checkout", {
          payee_vendor_id: "seller_receiver",
          amount: 120,
          payment_method: "manual",
        })
        expect(checkoutResponse.status).toBe(401)
      })
    })
  },
})
