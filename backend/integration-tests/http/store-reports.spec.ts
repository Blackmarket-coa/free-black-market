import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import jwt from "jsonwebtoken"

import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"
import { createAuthenticatedSeller, safe } from "./helpers/seller-auth"
import { ANONYMOUS_SUBMITTER_ID } from "../../src/modules/request/validators"
import { SELLER_REPORT_REQUEST_TYPE } from "../../src/api/store/seller-reports/route"

jest.setTimeout(240 * 1000)

/**
 * The storefront's report forms, end to end against a real database.
 *
 * `ReportSellerForm` (every seller page) used to log the report to the browser
 * console and then tell the reporter it would be acted on. What this pins is
 * the whole path the form now depends on: the framework's publishable-key gate,
 * the middleware stack, the handler, the request module's real `createRequest`
 * and its NOT NULL `submitter_id`, and the admin queue the report is meant to
 * reach. A unit spec that stubs the module cannot see the last two.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    // Created per-test: the integration runner resets the DB between tests.
    let pak: ReturnType<typeof pakHeaders>
    beforeEach(async () => {
      pak = pakHeaders(await createPublishableKeyToken(getContainer))
    })

    // GET /admin/requests sits behind Medusa's bearer auth, which verifies the
    // token against the server's JWT_SECRET and the actor type.
    const adminHeaders = () => ({
      headers: {
        authorization: `Bearer ${jwt.sign(
          { actor_id: "user_report_reviewer", actor_type: "user", auth_identity_id: "authid_reviewer", app_metadata: {} },
          process.env.JWT_SECRET as string,
          { expiresIn: "1h" }
        )}`,
      },
    })

    const adminQueue = async (type: string) => {
      const res = await safe(api.get(`/admin/requests?type=${type}`, adminHeaders()))
      expect(res.status).toBe(200)
      return res.data.requests as Array<Record<string, any>>
    }

    const comment = "This shop sells prints of artwork I hold the copyright to."

    describe("POST /store/seller-reports", () => {
      it("files an anonymous report against a real seller into the admin request queue", async () => {
        const { seller } = await createAuthenticatedSeller({ api, getContainer })

        const res = await safe(
          api.post(
            "/store/seller-reports",
            {
              seller_id: seller.id,
              reason: "trademark_copyright_dmca",
              comment,
              reporter_email: "rights@example.com",
            },
            pak
          )
        )

        expect(res.status).toBe(201)
        expect(res.data).toEqual({ id: expect.any(String), status: "pending" })

        const queue = await adminQueue(SELLER_REPORT_REQUEST_TYPE)
        expect(queue).toHaveLength(1)
        expect(queue[0]).toMatchObject({
          id: res.data.id,
          type: SELLER_REPORT_REQUEST_TYPE,
          status: "pending",
          submitter_id: ANONYMOUS_SUBMITTER_ID,
          requester_id: null,
          data: {
            seller_id: seller.id,
            reason: "trademark_copyright_dmca",
            comment,
            reporter_email: "rights@example.com",
            source: "storefront",
          },
        })
      })

      it("refuses a report naming a seller that does not exist, and files nothing", async () => {
        const res = await safe(
          api.post(
            "/store/seller-reports",
            { seller_id: "sel_does_not_exist", reason: "counterfeit", comment },
            pak
          )
        )

        expect(res.status).toBe(404)
        expect(await adminQueue(SELLER_REPORT_REQUEST_TYPE)).toHaveLength(0)
      })

      it("refuses a body with no seller, and files nothing", async () => {
        const res = await safe(
          api.post("/store/seller-reports", { reason: "counterfeit", comment }, pak)
        )

        expect(res.status).toBe(400)
        expect(await adminQueue(SELLER_REPORT_REQUEST_TYPE)).toHaveLength(0)
      })
    })

    describe("POST /store/product-reports", () => {
      it("files an anonymous listing report into the admin request queue", async () => {
        // The route exists to accept reports from rights-holders with no
        // account here; the browser form sends no credentials at all.
        const res = await safe(
          api.post(
            "/store/product-reports",
            { product_id: "prod_reported", reason: "trademark_copyright_dmca", comment },
            pak
          )
        )

        expect(res.status).toBe(201)
        const queue = await adminQueue("listing_report")
        expect(queue).toHaveLength(1)
        expect(queue[0]).toMatchObject({
          id: res.data.id,
          submitter_id: ANONYMOUS_SUBMITTER_ID,
          data: { product_id: "prod_reported" },
        })
      })
    })
  },
})
