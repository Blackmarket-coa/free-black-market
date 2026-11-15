import { POST } from "../markets/route"
import {
  PredictionMode,
  PredictionPolicyService,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../modules/vendor-hype-operations-prediction/service"

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
  body?: Record<string, unknown>
}) => {
  const listHypeProfiles = jest.fn(async (filter: { id: string }) =>
    opts.profiles.filter((p) => p.id === filter.id)
  )
  return {
    req: {
      body: { ...validBody, ...opts.body },
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

  it("does not forward a policy_version from the body", async () => {
    const createPredictionMarket = jest.fn().mockResolvedValue({ id: "pm_1", state: "draft" })
    const { req } = makeReq({
      actorId: "cus_owner",
      profiles: [{ id: "hp_1", owner_id: "cus_owner" }],
      createPredictionMarket,
      body: { policy_version: "attacker_v9" },
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createPredictionMarket.mock.calls[0][0]).not.toHaveProperty("policy_version")
  })

  // SD-76 follow-up. The service's real createPredictionMarket and the real
  // policy behind the route: a refusal was a plain Error, which the framework
  // answered 500 "An unknown error occurred.".
  const realCreate = () => {
    const ctx = {
      policyService: new PredictionPolicyService(),
      createPredictionMarkets: jest.fn(async (rows: Array<Record<string, unknown>>) =>
        rows.map((row) => ({ id: "pm_1", ...row }))
      ),
    }
    const createPredictionMarket = jest.fn((input: unknown) =>
      VendorHypeOperationsPredictionService.prototype.createPredictionMarket.call(ctx as never, input as never)
    )
    return { ctx, createPredictionMarket }
  }

  it.each([
    [PredictionMode.SWEEPSTAKES, "US-CA"],
    [PredictionMode.SWEEPSTAKES, "US"],
    [PredictionMode.REGULATED_CASH, "US-NV"],
  ])("answers a %s market in %s 403 policy_denied with the reason, and creates nothing", async (mode, code) => {
    const { ctx, createPredictionMarket } = realCreate()
    const { req } = makeReq({
      actorId: "cus_owner",
      profiles: [{ id: "hp_1", owner_id: "cus_owner" }],
      createPredictionMarket,
      body: { mode, jurisdiction_code: code },
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      type: "policy_denied",
      code: "PREDICTION_MODE_NOT_PERMITTED",
      message: `${mode} markets are not permitted for US (profile US-RESTRICTED)`,
      policy_version: ctx.policyService.policyVersion,
    })
    expect(ctx.createPredictionMarkets).not.toHaveBeenCalled()
  })

  it("still creates a market the policy admits through the real service", async () => {
    const { ctx, createPredictionMarket } = realCreate()
    const { req } = makeReq({
      actorId: "cus_owner",
      profiles: [{ id: "hp_1", owner_id: "cus_owner" }],
      createPredictionMarket,
      body: { mode: PredictionMode.NON_CASH, jurisdiction_code: "US-CA" },
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(ctx.createPredictionMarkets).toHaveBeenCalledTimes(1)
  })

  it("lets any other error through to the framework's handler", async () => {
    const boom = new Error("database is down")
    const createPredictionMarket = jest.fn().mockRejectedValue(boom)
    const { req } = makeReq({
      actorId: "cus_owner",
      profiles: [{ id: "hp_1", owner_id: "cus_owner" }],
      createPredictionMarket,
    })

    await expect(POST(req as never, createRes() as never)).rejects.toBe(boom)
  })
})
