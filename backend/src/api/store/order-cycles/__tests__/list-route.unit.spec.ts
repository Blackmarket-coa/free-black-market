import { GET } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"

/**
 * `?seller_id=` on `GET /store/order-cycles` mapped `order_cycle_seller.id`
 * (the membership row) where the cycle id was needed, so a per-farm cycle
 * list always came back empty (`docs/CDFI_COOP_ROADMAP.md` §1a).
 */

type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

type RouteArgs = Parameters<typeof GET>
const invoke = (req: unknown, res: TestRes) =>
  GET(req as RouteArgs[0], res as unknown as RouteArgs[1])

const makeReq = (service: unknown, query: Record<string, unknown>) => ({
  query,
  scope: {
    resolve: (key: string) => (key === ORDER_CYCLE_MODULE ? service : undefined),
  },
})

describe("GET /store/order-cycles — per-seller filter", () => {
  it("filters by the membership's order_cycle_id, not the membership id", async () => {
    const service = {
      listOrderCycleSellers: jest
        .fn()
        .mockResolvedValue([{ id: "ocs_1", order_cycle_id: "oc_1", seller_id: "sel_1", is_active: true }]),
      listOrderCycles: jest.fn().mockResolvedValue([]),
      listOrderCycleProducts: jest.fn().mockResolvedValue([]),
    }
    const res = createRes()

    await invoke(makeReq(service, { seller_id: "sel_1" }), res)

    expect(service.listOrderCycleSellers).toHaveBeenCalledWith({ seller_id: "sel_1", is_active: true })
    const [filters] = service.listOrderCycles.mock.calls[0]
    expect(filters).toMatchObject({ id: ["oc_1"], status: ["open"] })
  })

  it("returns an empty page without querying cycles when the seller has no memberships", async () => {
    const service = {
      listOrderCycleSellers: jest.fn().mockResolvedValue([]),
      listOrderCycles: jest.fn(),
      listOrderCycleProducts: jest.fn(),
    }
    const res = createRes()

    await invoke(makeReq(service, { seller_id: "sel_none" }), res)

    expect(res.body).toEqual({ order_cycles: [], count: 0, limit: 20, offset: 0 })
    expect(service.listOrderCycles).not.toHaveBeenCalled()
  })
})
