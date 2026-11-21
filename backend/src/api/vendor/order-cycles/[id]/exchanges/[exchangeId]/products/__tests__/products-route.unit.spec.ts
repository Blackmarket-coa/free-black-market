import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
 *
 * And it took any variant id: through the service's upsert on (cycle,
 * variant) it moved another store's row onto the caller's exchange and
 * rewrote its price and quantity (SD-158). Rows are now the caller's own:
 * its exchange, its variants, matched by cycle, variant and store.
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

const FORBIDDEN = { message: "You do not have access to this record.", type: "not_allowed" }

type Row = { id: string; seller_id: string; variant_id: string }

type Overrides = {
  cycle?: Record<string, unknown> | null
  exchange?: Record<string, unknown> | null
  memberships?: Array<{ seller_id: string; is_active: boolean }>
  /** The cycle's existing rows. */
  rows?: Row[]
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
  listOrderCycleProducts: jest.fn(async (filters: Record<string, unknown>) =>
    (o.rows ?? []).filter((row) => {
      const variants = filters.variant_id
      if (Array.isArray(variants) ? !variants.includes(row.variant_id) : variants !== undefined && variants !== row.variant_id) {
        return false
      }
      return filters.seller_id === undefined || filters.seller_id === row.seller_id
    })
  ),
  createOrderCycleProducts: jest.fn(async () => ({ id: "ocp_raw" })),
  updateOrderCycleProducts: jest.fn(async () => ({ id: "ocp_upd" })),
})

/**
 * Who owns which variant: var_1 is a product of sel_owner's, var_member of
 * sel_member's; anything else does not exist.
 */
const VARIANT_PRODUCT: Record<string, string> = { var_1: "prod_owner", var_member: "prod_member" }
const PRODUCT_SELLER: Record<string, string> = { prod_owner: "sel_owner", prod_member: "sel_member" }

const query = {
  graph: jest.fn(async ({ entity, filters }: { entity: string; filters: { id?: string[]; product_id?: string[] } }) => {
    if (entity === "product_variant") {
      return {
        data: (filters.id ?? [])
          .filter((id) => VARIANT_PRODUCT[id])
          .map((id) => ({ id, product_id: VARIANT_PRODUCT[id] })),
      }
    }
    if (entity === "seller_product") {
      return {
        data: (filters.product_id ?? [])
          .filter((id) => PRODUCT_SELLER[id])
          .map((id) => ({ product_id: id, seller_id: PRODUCT_SELLER[id] })),
      }
    }
    return { data: [] }
  }),
}

type Service = ReturnType<typeof makeService>

const makeReq = (
  service: Service,
  actorId: string | undefined,
  params: { id: string; exchangeId: string },
  body?: unknown
) => ({
  params,
  body,
  // A request the vendor gate let through for this store: the actor is a
  // member, and `actorId` here names the store the gate resolved (SD-145:
  // cycle and template ownership is the store's, never the member's).
  auth_context: actorId ? { actor_id: `mem_of_${actorId}` } : undefined,
  _seller_id: actorId,
  _sellerContextResolved: actorId ? true : undefined,
  scope: {
    resolve: (key: string) =>
      key === ORDER_CYCLE_MODULE
        ? service
        : key === ContainerRegistrationKeys.QUERY
          ? query
          : undefined,
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
  beforeEach(() => {
    query.graph.mockClear()
  })

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
    expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("refuses a write from a participant who does not own the exchange", async () => {
    const service = makeService({ memberships: [{ seller_id: "sel_member", is_active: true }] })
    const res = await callPost(service, "sel_member")

    expect(res.statusCode).toBe(403)
    expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("lets the coordinator put its own variant on its own exchange, in the exchange's cycle", async () => {
    const service = makeService()
    const res = await callPost(service, "sel_owner", undefined, { products: [{ variant_id: "var_1", override_price: 4 }] })

    expect(res.statusCode).toBe(201)
    // The cycle id comes from the exchange, so a mismatched path id can never
    // decide where the row lands; the seller is the caller's store.
    expect(service.createOrderCycleProducts).toHaveBeenCalledWith({
      order_cycle_id: "oc_1",
      variant_id: "var_1",
      seller_id: "sel_owner",
      exchange_id: "exch_1",
      override_price: 4,
    })
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("updates the store's own row for the variant, matched by cycle, variant and store", async () => {
    const service = makeService({ rows: [{ id: "ocp_own", seller_id: "sel_owner", variant_id: "var_1" }] })
    const res = await callPost(service, "sel_owner", undefined, { products: [{ variant_id: "var_1", available_quantity: 3 }] })

    expect(res.statusCode).toBe(201)
    expect(service.listOrderCycleProducts).toHaveBeenCalledWith(
      { order_cycle_id: "oc_1", variant_id: "var_1", seller_id: "sel_owner" },
      { take: 1 }
    )
    expect(service.updateOrderCycleProducts).toHaveBeenCalledWith({ id: "ocp_own", exchange_id: "exch_1", available_quantity: 3 })
    expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("refuses another store's variant, or one that does not exist, alike and before anything is written", async () => {
    for (const variant_id of ["var_member", "var_missing"]) {
      const service = makeService()
      const res = await callPost(service, "sel_owner", undefined, { products: [{ variant_id: "var_1" }, { variant_id }] })

      expect({ status: res.statusCode, body: res.body }).toEqual({ status: 403, body: FORBIDDEN })
      expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
      expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
    }
  })

  it("refuses the store's variant when another store holds the cycle's row for it, and leaves that row alone", async () => {
    const service = makeService({ rows: [{ id: "ocp_theirs", seller_id: "sel_member", variant_id: "var_1" }] })
    const res = await callPost(service, "sel_owner")

    expect(res.statusCode).toBe(409)
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
    expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("refuses the coordinator writing rows on a participant's exchange, with the participant's variant or its own", async () => {
    for (const variant_id of ["var_member", "var_1"]) {
      const service = makeService({
        exchange: { ...EXCHANGE, seller_id: "sel_member" },
        memberships: [{ seller_id: "sel_member", is_active: true }],
      })
      const res = await callPost(service, "sel_owner", undefined, { products: [{ variant_id, override_price: 0.01 }] })

      expect({ variant_id, status: res.statusCode, body: res.body }).toEqual({ variant_id, status: 403, body: FORBIDDEN })
      expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
      expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
    }
  })

  it("refuses an id that is not one string, naming the field and not echoing it", async () => {
    const service = makeService()
    const res = await callPost(service, "sel_owner", undefined, { products: [{ variant_id: ["var_1", "var_member"] }] })

    expect({ status: res.statusCode, body: res.body }).toEqual({
      status: 400,
      body: { message: "products[0].variant_id is invalid", type: "invalid_data" },
    })
    expect(query.graph).not.toHaveBeenCalled()
  })

  it("answers a failed write with what failed, never the error's text", async () => {
    const service = makeService()
    service.createOrderCycleProducts.mockRejectedValueOnce(
      new Error('insert into "order_cycle_product" - column "raw_override_price" does not exist')
    )
    const res = await callPost(service, "sel_owner")

    expect({ status: res.statusCode, body: res.body }).toEqual({ status: 500, body: { message: "Failed to add products" } })
  })

  it("rejects an empty product list before touching the service", async () => {
    const service = makeService()
    const res = await callPost(service, "sel_owner", { id: "oc_1", exchangeId: "exch_1" }, { products: [] })

    expect(res.statusCode).toBe(400)
    expect(service.createOrderCycleProducts).not.toHaveBeenCalled()
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })
})
