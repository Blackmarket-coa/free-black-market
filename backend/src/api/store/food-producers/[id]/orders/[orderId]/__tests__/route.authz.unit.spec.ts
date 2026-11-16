/**
 * Authorization on the producer single-order read (SEC-2 residual).
 *
 * `GET /store/food-producers/:id/orders/:orderId` is unauthenticated (the
 * middleware gates write verbs only) and returned the full food_order —
 * recipient name, phone, email, delivery address — with its items and
 * delivery, to anyone who could name a producer id and an order id. The list
 * route was closed under D10-1; this sibling was missed.
 *
 * The owner of one producer is a stranger to the others' orders. For them the
 * route answered 404 for an order id that does not exist and 403 "Order does
 * not belong to this producer" for one that does (seen on Postgres,
 * `integration-tests/http/store-food-network-write-authz.spec.ts`), which
 * told them which order ids exist.
 *
 * PUT kept that pair after GET was closed (SD-107), and is covered below with
 * the same cases. Its echo of the updated order was also a read: to the
 * producer's recorded owner it still is; a caller let through on a producer
 * with no owner on record gets the order's id and status.
 */
import { MedusaError } from "@medusajs/framework/utils"
import { GET, PUT } from "../route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../../../modules/food-distribution"

type Res = { statusCode: number; body: unknown; status: (c: number) => Res; json: (p: unknown) => Res }
const createRes = (): Res => {
  const res = { statusCode: 200, body: undefined } as Res
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

const ORDER = {
  id: "fo_1",
  producer_id: "fp_1",
  recipient_name: "Ada Lovelace",
  recipient_phone: "+15550000000",
  recipient_email: "ada@example.com",
  delivery_address_line_1: "12 Analytical Way",
}

const REFUSAL = { message: "You do not have access to this record.", type: "not_allowed" }

const makeReq = (opts: {
  actorId?: string
  ownerId?: string | null
  orderProducer?: string
  orderMissing?: boolean
  orderLookupFails?: Error
  body?: Record<string, unknown>
}) => {
  const service = {
    retrieveFoodProducer: jest.fn(async () => ({
      id: "fp_1",
      owner_id: opts.ownerId === undefined ? "cus_owner" : opts.ownerId,
    })),
    // A missing order is a thrown not-found, as the module's retrieve
    // answers it; it never returns null.
    retrieveFoodOrder: jest.fn(async (id: string) => {
      if (opts.orderLookupFails) throw opts.orderLookupFails
      if (opts.orderMissing) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, `FoodOrder with id: ${id} was not found`)
      }
      return { ...ORDER, producer_id: opts.orderProducer ?? "fp_1" }
    }),
    listFoodOrderItems: jest.fn(async () => [{ id: "foi_1" }]),
    listFoodDeliveries: jest.fn(async () => [
      { id: "del_1", delivery_address: "12 Analytical Way", proof_pin_code: "4821" },
    ]),
    updateFoodOrders: jest.fn(async (data: Record<string, unknown>) => ({
      ...ORDER,
      status: "CONFIRMED",
      ...data,
    })),
    updateDeliveryStatus: jest.fn(async () => ({})),
  }
  const req = {
    params: { id: "fp_1", orderId: "fo_1" },
    body: opts.body ?? {},
    ...(opts.actorId ? { auth_context: { actor_id: opts.actorId } } : {}),
    scope: {
      resolve: (key: string) => {
        if (key === FOOD_DISTRIBUTION_MODULE) return service
        throw new Error(`unresolvable: ${key}`)
      },
    },
  }
  return { req: req as never, service }
}

const leaks = (body: unknown) => JSON.stringify(body ?? "")

describe("GET /store/food-producers/:id/orders/:orderId — authorization", () => {
  it.each([
    ["an anonymous caller", {}],
    ["a signed-in stranger", { actorId: "cus_stranger" }],
    ["anyone, when the producer has no recorded owner", { actorId: "cus_any", ownerId: null }],
  ])("refuses %s with 403 before looking the order up", async (_label, opts) => {
    const { req, service } = makeReq(opts as { actorId?: string; ownerId?: string | null })
    const res = createRes()

    await GET(req, res as never)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(REFUSAL)
    // Checked before the order lookup: a non-owner learns nothing about order ids.
    expect(service.retrieveFoodOrder).not.toHaveBeenCalled()
    expect(leaks(res.body)).not.toContain("Ada Lovelace")
    expect(leaks(res.body)).not.toContain("Analytical Way")
  })

  it("serves the producer's owner the order with its items and delivery", async () => {
    const { req } = makeReq({ actorId: "cus_owner" })
    const res = createRes()

    await GET(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(leaks(res.body)).toContain("Ada Lovelace")
    expect((res.body as { order: { items: unknown[] } }).order.items).toHaveLength(1)
  })

  it("serves the order's delivery without its proof PIN", async () => {
    const { req } = makeReq({ actorId: "cus_owner" })
    const res = createRes()

    await GET(req, res as never)

    const delivery = (res.body as { order: { delivery: Record<string, unknown> } }).order.delivery
    expect(delivery).toMatchObject({ id: "del_1", delivery_address: "12 Analytical Way" })
    expect(delivery).not.toHaveProperty("proof_pin_code")
    expect(leaks(res.body)).not.toContain("4821")
  })

  it("still refuses the owner an order that belongs to another producer", async () => {
    const { req } = makeReq({ actorId: "cus_owner", orderProducer: "fp_other" })
    const res = createRes()

    await GET(req, res as never)

    expect(res.statusCode).toBe(403)
    expect(leaks(res.body)).not.toContain("Ada Lovelace")
  })

  it("refuses the owner another producer's order and an order that does not exist alike", async () => {
    // Any signed-in account can register a producer and be its owner, so
    // this pair of answers has to say nothing.
    const anothers = createRes()
    await GET(makeReq({ actorId: "cus_owner", orderProducer: "fp_other" }).req, anothers as never)
    const missing = createRes()
    await GET(makeReq({ actorId: "cus_owner", orderMissing: true }).req, missing as never)

    expect([anothers.statusCode, anothers.body]).toEqual([403, REFUSAL])
    expect([missing.statusCode, missing.body]).toEqual([403, REFUSAL])
  })

  it("does not turn a failed order lookup into a refusal", async () => {
    const res = createRes()
    await expect(
      GET(
        makeReq({ actorId: "cus_owner", orderLookupFails: new Error("connection terminated") }).req,
        res as never
      )
    ).rejects.toThrow("connection terminated")
    expect(res.statusCode).toBe(200)
  })
})

describe("PUT /store/food-producers/:id/orders/:orderId — authorization", () => {
  const put = async (opts: Parameters<typeof makeReq>[0]) => {
    const { req, service } = makeReq({ body: { producer_notes: "ready at six" }, ...opts })
    const res = createRes()
    await PUT(req, res as never)
    return { res, service }
  }

  it("refuses the owner another producer's order and an order that does not exist alike", async () => {
    // The pair GET used to give, left on this verb: 403 "Order does not
    // belong to this producer" and 404 (seen on Postgres as the owner of a
    // different producer). Any account can own a producer.
    const anothers = await put({ actorId: "cus_owner", orderProducer: "fp_other" })
    const missing = await put({ actorId: "cus_owner", orderMissing: true })

    expect([anothers.res.statusCode, anothers.res.body]).toEqual([403, REFUSAL])
    expect([missing.res.statusCode, missing.res.body]).toEqual([403, REFUSAL])
    expect(anothers.service.updateFoodOrders).not.toHaveBeenCalled()
    expect(missing.service.updateFoodOrders).not.toHaveBeenCalled()
  })

  it("still refuses a stranger before looking the order up", async () => {
    const { res, service } = await put({ actorId: "cus_stranger" })

    expect(res.statusCode).toBe(403)
    expect(service.retrieveFoodOrder).not.toHaveBeenCalled()
    expect(service.updateFoodOrders).not.toHaveBeenCalled()
  })

  it("lets the producer's owner update its order, and echoes the order to them", async () => {
    const { res, service } = await put({ actorId: "cus_owner" })

    expect(res.statusCode).toBe(200)
    expect(service.updateFoodOrders).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fo_1", producer_notes: "ready at six" })
    )
    expect(leaks(res.body)).toContain("Ada Lovelace")
  })

  it("acknowledges a write on a producer with no recorded owner without echoing the order", async () => {
    // `actorMayManage` lets any signed-in account act on such a producer.
    // The echo was that account's read of the recipient's name, phone, email
    // and address, which GET refuses it.
    const { res, service } = await put({ actorId: "cus_anyone", ownerId: null })

    expect(res.statusCode).toBe(200)
    expect(service.updateFoodOrders).toHaveBeenCalled()
    expect(res.body).toEqual({ order: { id: "fo_1", status: "CONFIRMED" } })
    expect(leaks(res.body)).not.toContain("Ada Lovelace")
    expect(leaks(res.body)).not.toContain("Analytical Way")
  })

  it("does not turn a failed order lookup into a refusal", async () => {
    await expect(
      put({ actorId: "cus_owner", orderLookupFails: new Error("connection terminated") })
    ).rejects.toThrow("connection terminated")
  })
})
