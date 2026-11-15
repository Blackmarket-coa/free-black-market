import { existsSync } from "fs"
import { join } from "path"
import { MedusaError } from "@medusajs/framework/utils"
import { POST } from "../markets/[id]/state/route"
import {
  PredictionMarketState,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../modules/vendor-hype-operations-prediction"

/**
 * Market lifecycle transitions are an operator action. They used to be served
 * at POST /store/vendor-hype/markets/:id/state to any signed-in customer,
 * seller or driver.
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

const makeReq = (
  authContext: Record<string, unknown> | undefined,
  transitionPredictionMarketState: jest.Mock,
  // `{ body: undefined }` sends no body; omitting the argument sends a valid one.
  override?: { body: unknown }
) => ({
  params: { id: "pm_1" },
  body: override ? override.body : { state: PredictionMarketState.SCHEDULED },
  ...(authContext ? { auth_context: authContext } : {}),
  scope: {
    resolve: (key: string) => {
      if (key !== VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE) {
        throw new Error(`unexpected container key ${key}`)
      }
      return { transitionPredictionMarketState }
    },
  },
})

describe("POST /admin/vendor-hype/markets/:id/state", () => {
  it.each([
    ["a customer", { actor_id: "cus_1", actor_type: "customer" }],
    ["a seller", { actor_id: "mem_1", actor_type: "seller" }],
    ["a secret API key", { actor_id: "apk_1", actor_type: "api-key" }],
    ["a user token with no actor id", { actor_type: "user" }],
    ["no auth context at all", undefined],
  ])("refuses %s", async (_label, authContext) => {
    const transitionPredictionMarketState = jest.fn()
    const res = createRes()

    await POST(makeReq(authContext, transitionPredictionMarketState) as never, res as never)

    expect(res.statusCode).toBe(403)
    expect(transitionPredictionMarketState).not.toHaveBeenCalled()
  })

  it("transitions the market for an admin user", async () => {
    const transitionPredictionMarketState = jest
      .fn()
      .mockResolvedValue({ id: "pm_1", state: PredictionMarketState.SCHEDULED })
    const res = createRes()

    await POST(
      makeReq({ actor_id: "user_1", actor_type: "user" }, transitionPredictionMarketState) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(transitionPredictionMarketState).toHaveBeenCalledWith("pm_1", PredictionMarketState.SCHEDULED)
  })

  const admin = { actor_id: "user_1", actor_type: "user" }

  it.each([
    ["an unknown state", { state: "bogus" }],
    ["no state", {}],
    ["no body", undefined],
  ])("answers %s with 400 rather than a thrown parse error (a 500)", async (_label, body) => {
    const transitionPredictionMarketState = jest.fn()
    const res = createRes()

    await POST(makeReq(admin, transitionPredictionMarketState, { body }) as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(res.body.type).toBe("invalid_data")
    expect(transitionPredictionMarketState).not.toHaveBeenCalled()
  })

  it.each([
    ["an unknown market", MedusaError.Types.NOT_FOUND],
    ["an illegal transition", MedusaError.Types.NOT_ALLOWED],
  ])("passes the service's typed error for %s through to the framework handler", async (_label, type) => {
    // The framework maps NOT_FOUND to 404 and NOT_ALLOWED to 400; the
    // integration spec checks those codes on the real stack. Here: the route
    // neither swallows the error nor rewraps it as something untyped.
    const error = new MedusaError(type, "refused")
    const transitionPredictionMarketState = jest.fn().mockRejectedValue(error)
    const res = createRes()

    await expect(
      POST(makeReq(admin, transitionPredictionMarketState) as never, res as never)
    ).rejects.toBe(error)
  })

  it("is no longer served under /store", () => {
    // The store route had no actor check at all; re-adding it would reopen the
    // hole regardless of what this admin route does.
    const storeRoute = join(__dirname, "../../../store/vendor-hype/markets/[id]/state/route.ts")
    expect(existsSync(storeRoute)).toBe(false)
    expect(existsSync(join(__dirname, "../../../store/vendor-hype/markets/route.ts"))).toBe(true)
  })
})
