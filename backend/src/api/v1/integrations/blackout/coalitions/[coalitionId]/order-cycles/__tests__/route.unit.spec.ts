import { POST } from "../route"

/**
 * The shared batch-ordering window for a coalition goods drive.
 *
 * The audit found nothing on the platform was writing `order_cycle_seller`
 * rows, so a hub's participants existed only in intent. This route's real job
 * is that projection: every coalition member with a shop becomes a
 * participating producer with an incoming exchange, on create AND on retry, so
 * a member who joined after the window opened still gets a place in it.
 */

jest.mock("../../../../../../../../lib/blackout-entitlements-auth", () => ({
  requireEntitlementsAuth: jest.fn(() => true),
}))

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: Record<string, unknown>) {
      res.body = payload
      return res
    },
  }
  return res
}

type Ctx = {
  cooperatives: Record<string, unknown>[]
  members: Record<string, unknown>[]
  cycles: Record<string, unknown>[]
}

const addSellerToOrderCycle = jest.fn(async () => ({}))
const createIncomingExchange = jest.fn(async () => ({}))
const createOrderCycles = jest.fn(async () => ({ id: "oc_new" }))

function makeReq(ctx: Ctx, body: Record<string, unknown>) {
  const cooperative = {
    listCooperatives: async () => ctx.cooperatives,
    listCooperativeMembers: async () => ctx.members,
  }
  const orderCycle = {
    listOrderCycles: async () => ctx.cycles,
    createOrderCycles,
    addSellerToOrderCycle,
    createIncomingExchange,
  }
  return {
    params: { coalitionId: "coa_1" },
    body,
    headers: {},
    scope: {
      resolve: (key: string) => (key === "cooperative" ? cooperative : orderCycle),
    },
  } as never
}

const window = {
  campaign_id: "camp_1",
  name: "Winter staples",
  opens_at: "2026-10-01T00:00:00.000Z",
  closes_at: "2026-10-08T00:00:00.000Z",
  dispatch_at: "2026-10-10T00:00:00.000Z",
}

const linkedCoop = [{ id: "coop_1", blackout_coalition_id: "coa_1" }]
const threeMembers = [
  { seller_id: "sel_admin", role: "ADMIN" },
  { seller_id: "sel_b", role: "PRODUCER" },
  { seller_id: "sel_c", role: "PRODUCER" },
]

beforeEach(() => {
  addSellerToOrderCycle.mockClear()
  createIncomingExchange.mockClear()
  createOrderCycles.mockClear()
})

describe("POST /v1/integrations/blackout/coalitions/:id/order-cycles", () => {
  it("opens a window and seats every member shop in it", async () => {
    const res = makeRes()
    await POST(makeReq({ cooperatives: linkedCoop, members: threeMembers, cycles: [] }, window), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body?.created).toBe(true)
    expect(addSellerToOrderCycle).toHaveBeenCalledTimes(3)
    // The admin member coordinates; the other two supply into the window.
    expect(addSellerToOrderCycle.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["sel_admin", "coordinator"],
      ["sel_b", "producer"],
      ["sel_c", "producer"],
    ])
    expect(createIncomingExchange).toHaveBeenCalledTimes(2)
  })

  it("reuses the existing window on a retry and re-seats members who joined since", async () => {
    const res = makeRes()
    await POST(
      makeReq(
        {
          cooperatives: linkedCoop,
          members: [...threeMembers, { seller_id: "sel_late", role: "PRODUCER" }],
          cycles: [{ id: "oc_existing" }],
        },
        window
      ),
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(res.body?.created).toBe(false)
    expect(res.body?.order_cycle_id).toBe("oc_existing")
    expect(createOrderCycles).not.toHaveBeenCalled()
    expect(addSellerToOrderCycle).toHaveBeenCalledTimes(4)
  })

  it("refuses a window that closes before it opens", async () => {
    const res = makeRes()
    await POST(
      makeReq({ cooperatives: linkedCoop, members: threeMembers, cycles: [] }, {
        ...window,
        opens_at: "2026-10-09T00:00:00.000Z",
      }),
      res as never
    )
    expect(res.statusCode).toBe(400)
    expect(res.body?.code).toBe("invalid_window")
    expect(createOrderCycles).not.toHaveBeenCalled()
  })

  it("refuses a dispatch scheduled before ordering closes", async () => {
    const res = makeRes()
    await POST(
      makeReq({ cooperatives: linkedCoop, members: threeMembers, cycles: [] }, {
        ...window,
        dispatch_at: "2026-10-02T00:00:00.000Z",
      }),
      res as never
    )
    expect(res.statusCode).toBe(400)
    expect(res.body?.code).toBe("invalid_window")
  })

  it("tells Blackout to stop pushing when no cooperative is linked", async () => {
    const res = makeRes()
    await POST(makeReq({ cooperatives: [], members: [], cycles: [] }, window), res as never)
    expect(res.statusCode).toBe(404)
    expect(res.body?.code).toBe("cooperative_unlinked")
  })

  it("refuses to open a window nobody can order from", async () => {
    const res = makeRes()
    await POST(
      makeReq({ cooperatives: linkedCoop, members: [{ seller_id: null }], cycles: [] }, window),
      res as never
    )
    expect(res.statusCode).toBe(409)
    expect(res.body?.code).toBe("no_member_shops")
    expect(createOrderCycles).not.toHaveBeenCalled()
  })
})
