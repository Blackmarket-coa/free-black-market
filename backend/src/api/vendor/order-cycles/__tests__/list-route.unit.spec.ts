import { GET } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"

/**
 * `GET /vendor/order-cycles` filtered on status alone until 2026-09-06, so
 * any authenticated seller read every coordinator's draft and closed cycles
 * (`docs/CDFI_COOP_ROADMAP.md` §1a). The list must be scoped to the cycles
 * the caller coordinates or takes part in, matching both id spellings the
 * vendor middleware produces (`mem_*` actor, `sel_*` seller).
 */

// api/vendor/** is inside the TS-3 de-`any`'d ratchet; typed doubles, no `any`.
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

const makeService = (memberships: Array<{ order_cycle_id: string }>) => ({
  listOrderCycleSellers: jest.fn().mockResolvedValue(memberships),
  listOrderCycles: jest.fn().mockResolvedValue([]),
})

const makeReq = (
  service: ReturnType<typeof makeService>,
  overrides: { actorId?: string; sellerId?: string; query?: Record<string, unknown> } = {}
) => ({
  _seller_id: overrides.sellerId,
  auth_context: overrides.actorId ? { actor_id: overrides.actorId } : undefined,
  query: overrides.query ?? {},
  scope: {
    resolve: (key: string) => (key === ORDER_CYCLE_MODULE ? service : undefined),
  },
})

describe("GET /vendor/order-cycles — seller scoping", () => {
  it("rejects a request with no actor and never lists", async () => {
    const service = makeService([])
    const res = createRes()

    await invoke(makeReq(service), res)

    expect(res.statusCode).toBe(401)
    expect(service.listOrderCycles).not.toHaveBeenCalled()
  })

  it("scopes to cycles the caller coordinates or takes part in, under both id spellings", async () => {
    const service = makeService([{ order_cycle_id: "oc_part" }])
    const res = createRes()

    await invoke(
      makeReq(service, { actorId: "mem_9", sellerId: "sel_1", query: { status: "open" } }),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(service.listOrderCycleSellers).toHaveBeenCalledWith({
      seller_id: ["mem_9", "sel_1"],
      is_active: true,
    })

    const [filters] = service.listOrderCycles.mock.calls[0]
    expect(filters).toEqual({
      $or: [{ coordinator_seller_id: ["mem_9", "sel_1"] }, { id: ["oc_part"] }],
      status: ["open"],
    })
    // The count query carries the same scope.
    expect(service.listOrderCycles.mock.calls[1][0]).toEqual(filters)
  })

  it("falls back to coordinator scope alone when the caller takes part in no cycle", async () => {
    const service = makeService([])
    const res = createRes()

    await invoke(makeReq(service, { actorId: "sel_1", sellerId: "sel_1" }), res)

    const [filters] = service.listOrderCycles.mock.calls[0]
    expect(filters).toEqual({ coordinator_seller_id: ["sel_1"] })
    expect(filters).not.toHaveProperty("$or")
    expect(filters).not.toHaveProperty("status")
  })
})
