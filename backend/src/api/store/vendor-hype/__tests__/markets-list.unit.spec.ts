import { GET } from "../markets/route"
import {
  PredictionMarketState,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../modules/vendor-hype-operations-prediction"

/**
 * GET /store/vendor-hype/markets is public. It used to list every market,
 * drafts included, with `created_by`. A draft is the profile owner's
 * unpublished work and needs operator approval to publish (architecture
 * §4.2), and `created_by` is the creating account's actor id.
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

const makeReq = (listPredictionMarkets: jest.Mock) => ({
  scope: {
    resolve: (key: string) => {
      if (key !== VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE) {
        throw new Error(`unexpected container key ${key}`)
      }
      return { listPredictionMarkets }
    },
  },
})

describe("GET /store/vendor-hype/markets", () => {
  it("asks only for states past DRAFT", async () => {
    const listPredictionMarkets = jest.fn().mockResolvedValue([])

    await GET(makeReq(listPredictionMarkets) as never, createRes() as never)

    expect(listPredictionMarkets).toHaveBeenCalledTimes(1)
    const filter = listPredictionMarkets.mock.calls[0][0] as { state: string[] }
    expect(filter.state).not.toContain(PredictionMarketState.DRAFT)
    expect([...filter.state].sort()).toEqual(
      Object.values(PredictionMarketState)
        .filter((s) => s !== PredictionMarketState.DRAFT)
        .sort()
    )
  })

  it("does not publish the creating account's id", async () => {
    const listPredictionMarkets = jest.fn().mockResolvedValue([
      {
        id: "pm_1",
        profile_id: "hp_1",
        title: "Ships 500 boxes by June",
        state: PredictionMarketState.OPEN,
        created_by: "cus_owner",
      },
    ])
    const res = createRes()

    await GET(makeReq(listPredictionMarkets) as never, res as never)

    const markets = res.body.markets as Array<Record<string, unknown>>
    expect(markets).toHaveLength(1)
    expect(markets[0]).toEqual(
      expect.objectContaining({ id: "pm_1", profile_id: "hp_1", state: PredictionMarketState.OPEN })
    )
    expect(markets[0]).not.toHaveProperty("created_by")
    expect(JSON.stringify(res.body)).not.toContain("cus_owner")
  })
})
