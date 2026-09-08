import { GET } from "../route"
import { POST as GENERATE } from "../generate/route"
import { POST as PACK } from "../[boxId]/pack/route"
import { POST as DISPATCH } from "../[boxId]/dispatch/route"
import { POST as CANCEL } from "../[boxId]/cancel/route"
import { ORDER_CYCLE_MODULE } from "../../../../../../modules/order-cycle"

/**
 * `/vendor/order-cycles/:id/share-boxes` — generate, list, pack, dispatch,
 * cancel. First callers of `generateBoxesForCycle`, `markShareBoxPacked`,
 * `markShareBoxDispatched`, `cancelShareBox` and `getShareBoxesForCycle`
 * (`docs/CDFI_COOP_ROADMAP.md` §3.7).
 *
 * Two things are asserted here that the service will not enforce on its own:
 * the box must belong to the cycle in the path (fourth route on this surface
 * to need that), and the lifecycle transition must be legal — the `mark*`
 * methods write `status` unconditionally.
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

const CYCLE = { id: "oc_1", coordinator_seller_id: "sel_coord", status: "open" }
const BOX = { id: "sb_1", order_cycle_id: "oc_1", status: "packed" }

type Overrides = {
  cycle?: Record<string, unknown> | null
  box?: Record<string, unknown> | null
  memberships?: Array<{ seller_id: string; is_active: boolean }>
  generateError?: Error
}

const makeService = (o: Overrides = {}) => ({
  retrieveOrderCycle: jest.fn(async (_id: string) => {
    if (o.cycle === null) throw new Error("not found")
    return o.cycle ?? CYCLE
  }),
  retrieveShareBox: jest.fn(async (_id: string) => {
    if (o.box === null) throw new Error("not found")
    return o.box ?? BOX
  }),
  listOrderCycleSellers: jest.fn(async (_f: Record<string, unknown>) => o.memberships ?? []),
  getShareBoxesForCycle: jest.fn(async (_id: string) => [{ id: "sb_1" }]),
  generateBoxesForCycle: jest.fn(async (_id: string) => {
    if (o.generateError) throw o.generateError
    return { cycle_id: "oc_1", generated: 2, reused: 1, skipped: 0, boxes: [] }
  }),
  markShareBoxPacked: jest.fn(async (id: string) => ({ id, status: "packed" })),
  markShareBoxDispatched: jest.fn(async (id: string) => ({
    id,
    status: "dispatched",
  })),
  cancelShareBox: jest.fn(async (id: string) => ({ id, status: "cancelled" })),
})

type Service = ReturnType<typeof makeService>

const makeReq = (service: Service, actorId: string | undefined) => ({
  params: { id: "oc_1", boxId: "sb_1" },
  query: {},
  body: undefined,
  auth_context: actorId ? { actor_id: actorId } : undefined,
  scope: {
    resolve: (key: string) =>
      key === ORDER_CYCLE_MODULE || key === "orderCycleModuleService"
        ? service
        : undefined,
  },
})

type Args = Parameters<typeof GET>

const call = async (
  handler: typeof GET,
  service: Service,
  actorId: string | undefined
) => {
  const res = createRes()
  await handler(
    makeReq(service, actorId) as unknown as Args[0],
    res as unknown as Args[1]
  )
  return res
}

const BOX_HANDLERS: Array<[string, typeof GET]> = [
  ["pack", PACK as typeof GET],
  ["dispatch", DISPATCH as typeof GET],
  ["cancel", CANCEL as typeof GET],
]

const ALL: Array<[string, typeof GET]> = [
  ["list", GET],
  ["generate", GENERATE as typeof GET],
  ...BOX_HANDLERS,
]

describe("coordinator gate", () => {
  it.each(ALL)("%s 401s without an authenticated seller", async (_n, h) => {
    const service = makeService()
    const res = await call(h, service, undefined)
    expect(res.statusCode).toBe(401)
  })

  it.each(ALL)("%s 403s a participant who is not the coordinator", async (_n, h) => {
    // A box carries customer_id and the member's realized items, so a
    // participant seller must not read or move them.
    const service = makeService({
      memberships: [{ seller_id: "sel_member", is_active: true }],
    })
    const res = await call(h, service, "sel_member")
    expect(res.statusCode).toBe(403)
    expect(service.getShareBoxesForCycle).not.toHaveBeenCalled()
    expect(service.generateBoxesForCycle).not.toHaveBeenCalled()
    expect(service.markShareBoxPacked).not.toHaveBeenCalled()
  })

  it.each(ALL)("%s 404s an unknown cycle", async (_n, h) => {
    const service = makeService({ cycle: null })
    const res = await call(h, service, "sel_coord")
    expect(res.statusCode).toBe(404)
  })
})

describe("belongs-to check", () => {
  it.each(BOX_HANDLERS)(
    "%s 404s a box belonging to a DIFFERENT cycle",
    async (_n, h) => {
      // Without this a guessed :id/:boxId pair moves a stranger's box.
      const service = makeService({
        box: { id: "sb_1", order_cycle_id: "oc_other", status: "packed" },
      })
      const res = await call(h, service, "sel_coord")
      expect(res.statusCode).toBe(404)
      expect(service.markShareBoxPacked).not.toHaveBeenCalled()
      expect(service.markShareBoxDispatched).not.toHaveBeenCalled()
      expect(service.cancelShareBox).not.toHaveBeenCalled()
    }
  )

  it.each(BOX_HANDLERS)("%s 404s a box that does not exist", async (_n, h) => {
    const service = makeService({ box: null })
    const res = await call(h, service, "sel_coord")
    expect(res.statusCode).toBe(404)
  })
})

describe("GET share-boxes", () => {
  it("returns the cycle's boxes to its coordinator", async () => {
    const service = makeService()
    const res = await call(GET, service, "sel_coord")
    expect(res.statusCode).toBe(200)
    expect(service.getShareBoxesForCycle).toHaveBeenCalledWith("oc_1")
  })
})

describe("generate", () => {
  it("reports generated and reused separately", async () => {
    const service = makeService()
    const res = await call(GENERATE as typeof GET, service, "sel_coord")
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ generated: 2, reused: 1 })
  })

  it("409s rather than 500s on a cancelled cycle", async () => {
    // The service throws for this; it is the caller's state, not a fault.
    const service = makeService({
      generateError: new Error("cannot generate boxes for a cancelled cycle"),
    })
    const res = await call(GENERATE as typeof GET, service, "sel_coord")
    expect(res.statusCode).toBe(409)
  })

  it("500s on an unexpected failure", async () => {
    const service = makeService({ generateError: new Error("database is on fire") })
    const res = await call(GENERATE as typeof GET, service, "sel_coord")
    expect(res.statusCode).toBe(500)
  })
})

describe("lifecycle guards at the route", () => {
  it("packs a pending or allocated box", async () => {
    for (const status of ["pending", "allocated"]) {
      const service = makeService({ box: { ...BOX, status } })
      const res = await call(PACK as typeof GET, service, "sel_coord")
      expect(res.statusCode).toBe(200)
      expect(service.markShareBoxPacked).toHaveBeenCalledWith("sb_1")
    }
  })

  it("refuses to pack a cancelled or dispatched box", async () => {
    for (const status of ["cancelled", "dispatched"]) {
      const service = makeService({ box: { ...BOX, status } })
      const res = await call(PACK as typeof GET, service, "sel_coord")
      expect(res.statusCode).toBe(409)
      expect(service.markShareBoxPacked).not.toHaveBeenCalled()
    }
  })

  it("dispatches only a packed box", async () => {
    const service = makeService({ box: { ...BOX, status: "packed" } })
    const res = await call(DISPATCH as typeof GET, service, "sel_coord")
    expect(res.statusCode).toBe(200)
    expect(service.markShareBoxDispatched).toHaveBeenCalledWith("sb_1")
  })

  it("refuses to dispatch a box that was never packed", async () => {
    // The lifecycle skip: reporting a delivery nobody filled.
    for (const status of ["pending", "allocated"]) {
      const service = makeService({ box: { ...BOX, status } })
      const res = await call(DISPATCH as typeof GET, service, "sel_coord")
      expect(res.statusCode).toBe(409)
      expect(service.markShareBoxDispatched).not.toHaveBeenCalled()
    }
  })

  it("refuses to cancel a box that already went out", async () => {
    const service = makeService({ box: { ...BOX, status: "dispatched" } })
    const res = await call(CANCEL as typeof GET, service, "sel_coord")
    expect(res.statusCode).toBe(409)
    expect(service.cancelShareBox).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({ from: "dispatched", to: "cancelled" })
  })

  it("cancels a box that has not left", async () => {
    for (const status of ["pending", "allocated", "packed", "skipped"]) {
      const service = makeService({ box: { ...BOX, status } })
      const res = await call(CANCEL as typeof GET, service, "sel_coord")
      expect(res.statusCode).toBe(200)
      expect(service.cancelShareBox).toHaveBeenCalledWith("sb_1")
    }
  })

  it("checks ownership before the transition, so a stranger learns nothing", async () => {
    const service = makeService({
      box: { id: "sb_1", order_cycle_id: "oc_other", status: "dispatched" },
      memberships: [{ seller_id: "sel_member", is_active: true }],
    })
    const res = await call(CANCEL as typeof GET, service, "sel_member")
    expect(res.statusCode).toBe(403)
  })
})
