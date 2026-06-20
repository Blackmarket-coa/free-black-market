import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    // /store/* routes require a publishable key resolvable to a sales channel.
    // Created per-test: the integration runner resets the DB between tests.
    let pak: ReturnType<typeof pakHeaders>
    beforeEach(async () => {
      pak = pakHeaders(await createPublishableKeyToken(getContainer))
    })

    describe("Store proposals query validation", () => {
      it("rejects invalid pagination values", async () => {
        const response = await api
          .get("/store/proposals?limit=1000&offset=-1", pak)
          .catch((e) => e.response)

        expect(response.status).toBe(400)
        expect(response.data.error).toBe("Invalid proposal query parameters")
      })
    })
  },
})
