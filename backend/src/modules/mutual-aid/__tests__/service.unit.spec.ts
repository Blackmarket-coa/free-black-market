import MutualAidModuleService from "../service"

const proto = MutualAidModuleService.prototype as any

const req = (over: Record<string, unknown> = {}) => ({
  id: "mar_1",
  requester_id: "cus_asker",
  category: "food",
  status: "OPEN",
  latitude: 42.3314,
  longitude: -83.0458,
  matched_offer_id: null,
  ...over,
})

describe("MutualAidModuleService", () => {
  describe("matchRequest", () => {
    const makeCtx = (request: any, opts: { pg?: boolean } = {}) => {
      const raw = jest.fn(async () => ({ rows: [{ id: request?.id }] }))
      return {
        raw,
        listMutualAidRequests: jest.fn(async () => (request ? [request] : [])),
        updateMutualAidRequests: jest.fn(async (input: any) => {
          Object.assign(request, input)
          return request
        }),
        updateMutualAidOffers: jest.fn(),
        resolvePgConnection: () => (opts.pg ? { raw } : undefined),
      }
    }

    it("refuses to let a requester fulfil their own request", async () => {
      const request = req()
      const ctx: any = makeCtx(request)

      // Otherwise someone could quietly close a request off the public board
      // while it appears to have been helped.
      await expect(
        proto.matchRequest.call(ctx, {
          request_id: "mar_1",
          helper_id: "cus_asker",
        })
      ).rejects.toThrow(/cannot fulfil their own/i)

      expect(ctx.updateMutualAidRequests).not.toHaveBeenCalled()
    })

    it("refuses a request that is not open", async () => {
      const ctx: any = makeCtx(req({ status: "MATCHED" }))

      await expect(
        proto.matchRequest.call(ctx, {
          request_id: "mar_1",
          helper_id: "cus_helper",
        })
      ).rejects.toThrow(/cannot match/i)
    })

    it("decides the race with a status = OPEN predicate", async () => {
      const request = req()
      const ctx: any = makeCtx(request, { pg: true })

      await proto.matchRequest.call(ctx, {
        request_id: "mar_1",
        offer_id: "mao_1",
        helper_id: "cus_helper",
      })

      const [sql, bindings] = ctx.raw.mock.calls[0]
      expect(sql).toContain("status = 'OPEN'")
      expect(bindings).toEqual(["mao_1", "cus_helper", "mar_1"])
      // The racy read-modify-write path must not run when SQL is available.
      expect(ctx.updateMutualAidRequests).not.toHaveBeenCalled()
    })

    it("loses the race gracefully when another helper got there first", async () => {
      const request = req()
      const ctx: any = makeCtx(request, { pg: true })
      ctx.raw = jest.fn(async () => ({ rows: [] }))
      ctx.resolvePgConnection = () => ({ raw: ctx.raw })

      // A person waiting on aid who is told twice that help is coming, and
      // then gets none, is worse off than one who was never matched.
      await expect(
        proto.matchRequest.call(ctx, {
          request_id: "mar_1",
          helper_id: "cus_late",
        })
      ).rejects.toThrow(/already been matched/i)
    })

    it("commits the offer alongside the match", async () => {
      const request = req()
      const ctx: any = makeCtx(request, { pg: true })

      await proto.matchRequest.call(ctx, {
        request_id: "mar_1",
        offer_id: "mao_1",
        helper_id: "cus_helper",
      })

      expect(ctx.updateMutualAidOffers).toHaveBeenCalledWith(
        expect.objectContaining({ id: "mao_1", status: "COMMITTED" })
      )
    })
  })

  describe("confirmFulfilled", () => {
    const makeCtx = (request: any) => ({
      listMutualAidRequests: jest.fn(async () => (request ? [request] : [])),
      updateMutualAidRequests: jest.fn(async (input: any) => {
        Object.assign(request, input)
        return request
      }),
      updateMutualAidOffers: jest.fn(),
    })

    it("lets only the requester confirm", async () => {
      const request = req({ status: "MATCHED", matched_helper_id: "cus_helper" })
      const ctx: any = makeCtx(request)

      // A helper marking their own good deed complete is the self-attestation
      // that makes a reputation score worthless — and this feeds XP.
      await expect(
        proto.confirmFulfilled.call(ctx, "mar_1", "cus_helper")
      ).rejects.toThrow(/only the requester/i)

      expect(ctx.updateMutualAidRequests).not.toHaveBeenCalled()
    })

    it("confirms for the requester and spends the offer", async () => {
      const request = req({
        status: "MATCHED",
        matched_offer_id: "mao_1",
      })
      const ctx: any = makeCtx(request)

      await proto.confirmFulfilled.call(ctx, "mar_1", "cus_asker")

      expect(request.status).toBe("FULFILLED")
      expect(ctx.updateMutualAidOffers).toHaveBeenCalledWith(
        expect.objectContaining({ id: "mao_1", status: "SPENT" })
      )
    })

    it("refuses to confirm a request that was never matched", async () => {
      const ctx: any = makeCtx(req({ status: "OPEN" }))

      await expect(
        proto.confirmFulfilled.call(ctx, "mar_1", "cus_asker")
      ).rejects.toThrow(/only a matched request/i)
    })
  })

  describe("findOffersForRequest", () => {
    it("filters by reach and sorts nearest first, unknown distance last", async () => {
      const ctx: any = {
        listMutualAidRequests: jest.fn(async () => [req()]),
        listMutualAidOffers: jest.fn(async () => [
          { id: "far", latitude: 42.2808, longitude: -83.743, service_radius_km: 100 },
          { id: "near", latitude: 42.3364, longitude: -83.0458, service_radius_km: 100 },
          { id: "unplaced", latitude: null, longitude: null, service_radius_km: null },
          { id: "out_of_reach", latitude: 42.2808, longitude: -83.743, service_radius_km: 5 },
        ]),
      }

      const matches = await proto.findOffersForRequest.call(ctx, "mar_1")

      expect(matches.map((m: any) => m.offer.id)).toEqual([
        "near",
        "far",
        "unplaced",
      ])
    })

    it("narrows candidates by category when the request has one", async () => {
      const ctx: any = {
        listMutualAidRequests: jest.fn(async () => [req({ category: "food" })]),
        listMutualAidOffers: jest.fn(async () => []),
      }

      await proto.findOffersForRequest.call(ctx, "mar_1")

      expect(ctx.listMutualAidOffers).toHaveBeenCalledWith(
        expect.objectContaining({ category: "food", status: "AVAILABLE" })
      )
    })

    it("404s an unknown request", async () => {
      const ctx: any = { listMutualAidRequests: jest.fn(async () => []) }

      await expect(
        proto.findOffersForRequest.call(ctx, "missing")
      ).rejects.toThrow(/not found/i)
    })
  })
})
