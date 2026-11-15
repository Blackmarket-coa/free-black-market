import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { REQUEST_MODULE } from "../../src/modules/request"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * GET and POST /vendor/requests/:id, which the vendor panel's request detail,
 * category edit, collection edit and review-report screens call and nothing
 * served. Real vendor logins (member tokens) and the real request module.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    async function filedBy(token: string) {
      const res = await safe(
        api.post(
          "/vendor/requests",
          { request: { type: "product_category", data: { name: "Ferments", handle: "ferments" } } },
          authHeader(token)
        )
      )
      expect(res.status).toBe(201)
      return res.data.request as { id: string }
    }

    it("serves a seller's own request, and refuses another seller's and a missing id the same way", async () => {
      const owner = await createAuthenticatedSeller({ api, getContainer })
      const rival = await createAuthenticatedSeller({ api, getContainer })
      const request = await filedBy(owner.token)

      const own = await safe(api.get(`/vendor/requests/${request.id}`, authHeader(owner.token)))
      expect(own.status).toBe(200)
      expect(own.data.request).toMatchObject({
        id: request.id,
        type: "product_category",
        status: "pending",
        data: { name: "Ferments", handle: "ferments" },
      })

      const theirs = await safe(api.get(`/vendor/requests/${request.id}`, authHeader(rival.token)))
      const missing = await safe(api.get(`/vendor/requests/req_does_not_exist`, authHeader(rival.token)))
      expect(theirs.status).toBe(403)
      expect(missing.status).toBe(403)
      expect(theirs.data).toEqual(missing.data)
    })

    it("lets the submitter edit a pending request's data, and nothing else", async () => {
      const owner = await createAuthenticatedSeller({ api, getContainer })
      const rival = await createAuthenticatedSeller({ api, getContainer })
      const request = await filedBy(owner.token)
      const edit = (token: string, body: unknown) =>
        safe(api.post(`/vendor/requests/${request.id}`, body, authHeader(token)))

      const byRival = await edit(rival.token, {
        request: { type: "product_category", data: { name: "Hijacked" } },
      })
      expect(byRival.status).toBe(403)

      const retyped = await edit(owner.token, { request: { type: "seller", data: { name: "x" } } })
      expect(retyped.status).toBe(400)

      const edited = await edit(owner.token, {
        request: { type: "product_category", data: { name: "Ferments & Pickles", handle: "ferments" } },
      })
      expect(edited.status).toBe(200)

      const service = getContainer().resolve(REQUEST_MODULE)
      expect(await service.retrieveRequest(request.id)).toMatchObject({
        type: "product_category",
        status: "pending",
        data: { name: "Ferments & Pickles", handle: "ferments" },
      })

      // Once an admin has decided it, the record of what was decided stays.
      await service.acceptRequest(request.id)
      const afterDecision = await edit(owner.token, {
        request: { type: "product_category", data: { name: "Changed after acceptance" } },
      })
      expect(afterDecision.status).toBe(409)
      expect((await service.retrieveRequest(request.id)).data).toMatchObject({ name: "Ferments & Pickles" })
    })
  },
})
