import { POST } from "../markets/route"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../modules/vendor-hype-operations-prediction"

/**
 * POST /store/vendor-hype/markets creates a market only under a hype profile
 * the caller owns. Before this, any signed-in account could create a market
 * under any `profile_id` it named in the body.
 */
type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res: TestRes = {
    statusCode: 200,
    body: {},
    status: (code: number) => {
      res.statusCode = code
      return res
    },
    json: (payload: unknown) => {
      res.body = (payload ?? {}) as Record<string, unknown>
      return res
    },
  }
  return res
}

const validBody = {
  profile_id: "hp_1",
  title: "Ships 500 boxes by June",
  jurisdiction_code: "US-RESTRICTED",
  oracle_config_id: "oracle_1",
  starts_at: "2026-12-01T00:00:00.000Z",
  locks_at: "2026-12-10T00:00:00.000Z",
}

const makeReq = (opts: {
  actorId?: string
  profiles: Array<{ id: string; owner_id: string }>
  createPredictionMarket: jest.Mock
}) => {
  const listHypeProfiles = jest.fn(async (filter: { id: string }) =>
    opts.profiles.filter((p) => p.id === filter.id)
  )
  return {
    req: {
      body: { ...validBody },
      ...(opts.actorId
        ? { auth_context: { actor_id: opts.actorId, actor_type: "customer" } }
        : {}),
      scope: {
        resolve: (key: string) => {
          if (key !== VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE) {
            throw new Error(`unexpected container key ${key}`)
          }
          return { listHypeProfiles, createPredictionMarket: opts.createPredictionMarket }
        },
      },
    },
    listHypeProfiles,
  }
}

describe("POST /store/vendor-hype/markets", () => {
  it("refuses an unauthenticated caller with 401", async () => {
    const createPredictionMarket = jest.fn()
    const { req } = makeReq({ profiles: [{ id: "hp_1", owner_id: "cus_owner" }], createPredictionMarket })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(401)
    expect(createPredictionMarket).not.toHaveBeenCalled()
  })

  it("refuses a signed-in account that does not own the profile", async () => {
    const createPredictionMarket = jest.fn()
    const { req, listHypeProfiles } = makeReq({
      actorId: "cus_stranger",
      profiles: [{ id: "hp_1", owner_id: "cus_owner" }],
      createPredictionMarket,
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(listHypeProfiles).toHaveBeenCalledWith({ id: "hp_1" })
    expect(res.statusCode).toBe(403)
    expect(res.body.type).toBe("not_allowed")
    expect(createPredictionMarket).not.toHaveBeenCalled()
  })

  it("gives a missing profile the same 403 as someone else's", async () => {
    const createPredictionMarket = jest.fn()
    const strangers = makeReq({
      actorId: "cus_stranger",
      profiles: [{ id: "hp_1", owner_id: "cus_owner" }],
      createPredictionMarket,
    })
    const missing = makeReq({ actorId: "cus_stranger", profiles: [], createPredictionMarket })
    const strangerRes = createRes()
    const missingRes = createRes()

    await POST(strangers.req as never, strangerRes as never)
    await POST(missing.req as never, missingRes as never)

    expect(missingRes.statusCode).toBe(403)
    expect(missingRes.body).toEqual(strangerRes.body)
    expect(createPredictionMarket).not.toHaveBeenCalled()
  })

  it("creates the market for the profile owner, attributed to them", async () => {
    const createPredictionMarket = jest.fn().mockResolvedValue({ id: "pm_1", state: "draft" })
    const { req } = makeReq({
      actorId: "cus_owner",
      profiles: [{ id: "hp_1", owner_id: "cus_owner" }],
      createPredictionMarket,
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createPredictionMarket).toHaveBeenCalledWith(
      expect.objectContaining({ profile_id: "hp_1", created_by: "cus_owner" })
    )
  })
})
