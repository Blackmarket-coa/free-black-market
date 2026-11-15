import { existsSync } from "fs"
import { join } from "path"
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
  transitionPredictionMarketState: jest.Mock
) => ({
  params: { id: "pm_1" },
  body: { state: PredictionMarketState.SCHEDULED },
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

  it("is no longer served under /store", () => {
    // The store route had no actor check at all; re-adding it would reopen the
    // hole regardless of what this admin route does.
    const storeRoute = join(__dirname, "../../../store/vendor-hype/markets/[id]/state/route.ts")
    expect(existsSync(storeRoute)).toBe(false)
    expect(existsSync(join(__dirname, "../../../store/vendor-hype/markets/route.ts"))).toBe(true)
  })
})
