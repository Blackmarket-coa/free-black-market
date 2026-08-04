import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(120 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    // Ensure no real GitHub credentials are present.
    GITHUB_ISSUE_REPO: "",
    GITHUB_APP_ID: "",
    GITHUB_APP_PRIVATE_KEY: "",
    GITHUB_APP_INSTALLATION_ID: "",
    GITHUB_PAT: "",
  },
  testSuite: ({ api, getContainer }) => {
    // /store/* routes require a publishable key resolvable to a sales channel.
    // Created per-test: the integration runner resets the DB between tests, so
    // a beforeAll key would not survive past the first test.
    let pak: ReturnType<typeof pakHeaders>
    beforeEach(async () => {
      pak = pakHeaders(await createPublishableKeyToken(getContainer))
    })

    describe("Bug report routes (no GitHub credentials configured)", () => {
      describe("GET /store/bug-report/config", () => {
        it("reports the reporter as disabled when not configured", async () => {
          const response = await api.get("/store/bug-report/config", pak)
          expect(response.status).toBe(200)
          expect(response.data).toEqual({ enabled: false })
        })
      })

      describe("POST /store/bug-report", () => {
        it("rejects too-short summaries with 400", async () => {
          const response = await api
            .post("/store/bug-report", { summary: "x", description: "y" }, pak)
            .catch((e) => e.response)
          expect(response.status).toBe(400)
        })

        it("returns 503 when GitHub is not configured", async () => {
          const response = await api
            .post(
              "/store/bug-report",
              {
                summary: "Cart total wrong",
                description: "Adding two items gives the wrong total in checkout",
              },
              pak,
            )
            .catch((e) => e.response)
          expect(response.status).toBe(503)
        })
      })

      describe("POST /vendor/bug-report", () => {
        it("requires seller authentication", async () => {
          const response = await api
            .post("/vendor/bug-report", {
              summary: "Order export crashes",
              description: "Clicking Export blows up the page on Firefox",
            })
            .catch((e) => e.response)
          expect(response.status).toBe(401)
        })
      })

      describe("POST /admin/bug-report", () => {
        it("requires admin authentication", async () => {
          const response = await api
            .post("/admin/bug-report", {
              summary: "Order details panel blank",
              description: "Some orders show an empty details panel on refresh",
            })
            .catch((e) => e.response)
          // Medusa admin auth returns 401 for unauthenticated requests.
          expect([401, 403]).toContain(response.status)
        })
      })
    })
  },
})
