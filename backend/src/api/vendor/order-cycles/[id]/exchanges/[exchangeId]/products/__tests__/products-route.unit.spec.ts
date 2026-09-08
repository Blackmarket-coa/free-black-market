import { GET, POST } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../../../../../modules/order-cycle"

/**
 * `GET`/`POST /vendor/order-cycles/:id/exchanges/:exchangeId/products` ran
 * with only the generic `/vendor/**` seller authentication until 2026-09-08:
 * every sibling under `order-cycles/[id]` resolved cycle access, this one
 * resolved nothing. So any authenticated seller could read a stranger's
 * exchange products, and POST took `order_cycle_id` from the path without
 * checking the exchange belonged to it — a guessed `:id`/`:exchangeId` pair
 * wrote into someone else's cycle.
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

const CYCLE = { id: "oc_1", coordinator_seller_id: "sel_owner" }
const EXCHANGE = { id: "exch_1", order_cycle_id: "oc_1", seller_id: "sel_owner" }

type Overrides = {
  cycle?: Record<string, unknown> | null
  exchange?: Record<string, unknown> | null
  memberships?: Array<{ seller_id: string; is_active: boolean }>
}

const makeService = (o: Overrides = {}) => ({
  retrieveOrderCycle: jest.fn(async () => {
    if (o.cycle === null) throw new Error("not found")
    return o.cycle ?? CYCLE
  }),
  retrieveOrderCycleExchange: jest.fn(async () => {
    if (o.exchange === null) throw new Error("not found")
    return o.exchange ?? EXCHANGE
  }),
  listOrderCycleSellers: jest.fn(async () => o.memberships ?? []),
  listOrderCycleProducts: jest.fn(async () => [{ id: "ocp_1" }]),
  addProductsToExchange: jest.fn(async () => [{ id: "ocp_new" }]),
  createOrderCycleProducts: jest.fn(async () => ({ id: "ocp_raw" })),
})

type Service = ReturnType<typeof makeService>

const makeReq = (
  service: Service,
  actorId: string | undefined,
  params: { id: string; exchangeId: string },
  body?: unknown
) => ({
  params,
  body,
  auth_context: actorId ? { actor_id: actorId } : undefined,
  scope: {
    resolve: (key: string) =>
      key === ORDER_CYCLE_MODULE || key === "orderCycleModuleService" ? service : undefined,
  },
})

type GetArgs = Parameters<typeof GET>
type PostArgs = Parameters<typeof POST>

const callGet = async (service: Service, actorId: string | undefined, params = { id: "oc_1", exchangeId: "exch_1" }) => {
  const res = createRes()
  await GET(makeReq(service, actorId, params) as unknown as GetArgs[0], res as unknown as GetArgs[1])
  return res
}

const callPost = async (
  service: Service,
  actorId: string | undefined,
  params = { id: "oc_1", exchangeId: "exch_1" },
  body: unknown = { products: [{ variant_id: "var_1" }] }
) => {
  const res = createRes()
  await POST(makeReq(service, actorId, params, body) as unknown as PostArgs[0], res as unknown as PostArgs[1])
  return res
}

describe("exchange products — object-level authorization", () => {
  it("rejects a request with no actor and never reads", async () => {
    const service = makeService()
    const res = await callGet(service, undefined)

    expect(res.statusCode).toBe(401)
    expect(service.listOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("refuses a seller who neither coordinates nor takes part in the cycle", async () => {
    const service = makeService()
    const res = await callGet(service, "sel_stranger")

    expect(res.statusCode).toBe(403)
    expect(service.listOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("lets an active participant read the exchange's products", async () => {
    const service = makeService({ memberships: [{ seller_id: "sel_member", is_active: true }] })
    const res = await callGet(service, "sel_member")

    expect(res.statusCode).toBe(200)
    expect(service.listOrderCycleProducts).toHaveBeenCalledWith({ exchange_id: "exch_1" })
  })

  it("404s when the exchange belongs to a different cycle than the path names", async () => {
    const service = makeService({ exchange: { ...EXCHANGE, order_cycle_id: "oc_other" } })
    const res = await callPost(service, "sel_owner")

    expect(res.statusCode).toBe(404)
    expect(service.addProductsToExchange).not.toHaveBeenCalled()
    expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("refuses a write from a participant who does not own the exchange", async () => {
    const service = makeService({ memberships: [{ seller_id: "sel_member", is_active: true }] })
    const res = await callPost(service, "sel_member")

    expect(res.statusCode).toBe(403)
    expect(service.addProductsToExchange).not.toHaveBeenCalled()
  })

  it("lets the coordinator add products through the upserting service method", async () => {
    const service = makeService()
    const res = await callPost(service, "sel_owner")

    expect(res.statusCode).toBe(201)
    // The service takes the cycle id from the exchange, so a mismatched path
    // id can never decide where the row lands.
    expect(service.addProductsToExchange).toHaveBeenCalledWith("exch_1", [
      {
        variant_id: "var_1",
        seller_id: "sel_owner",
        available_quantity: undefined,
        override_price: undefined,
      },
    ])
    expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("rejects an empty product list before touching the service", async () => {
    const service = makeService()
    const res = await callPost(service, "sel_owner", { id: "oc_1", exchangeId: "exch_1" }, { products: [] })

    expect(res.statusCode).toBe(400)
    expect(service.addProductsToExchange).not.toHaveBeenCalled()
  })
})
