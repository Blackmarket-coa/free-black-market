/**
 * Authorization on the producer order list.
 *
 * The hole this closes: `api/middlewares.ts` gates `/store/food-producers` on
 * write verbs only, so GET was unauthenticated, and the handler read `:id`
 * from the URL with no actor check. `GET /store/food-producers` is public
 * too, so producer ids were enumerable — an anonymous caller could walk every
 * producer and read every order, and a `food_order` carries recipient name,
 * phone, email and delivery address.
 */
import { GET } from "../route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../../modules/food-distribution"

const createRes = () => {
  const res: Record<string, unknown> & {
    statusCode: number
    body: unknown
  } = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as typeof res & {
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

const ORDERS = [
  {
    id: "fo_1",
    recipient_name: "Ada Lovelace",
    recipient_phone: "+15550000000",
    recipient_email: "ada@example.com",
    delivery_address_line_1: "12 Analytical Way",
  },
]

const makeReq = (opts: { actorId?: string; ownerId?: string | null }) => {
  const service = {
    retrieveFoodProducer: jest.fn(async () => ({
      id: "fp_1",
      owner_id: opts.ownerId === undefined ? "cus_owner" : opts.ownerId,
    })),
    getProducerOrders: jest.fn(async () => ORDERS),
    listFoodOrders: jest.fn(async () => ORDERS),
  }
  const req = {
    params: { id: "fp_1" },
    query: {},
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

describe("GET /store/food-producers/:id/orders — authorization", () => {
  it("refuses an anonymous caller and reads no orders", async () => {
    const { req, service } = makeReq({})
    const res = createRes()

    await GET(req, res as never)

    expect(res.statusCode).toBe(403)
    expect(service.getProducerOrders).not.toHaveBeenCalled()
    expect(leaks(res.body)).not.toContain("Ada Lovelace")
    expect(leaks(res.body)).not.toContain("Analytical Way")
  })

  it("refuses a signed-in caller who is not the owner", async () => {
    const { req, service } = makeReq({ actorId: "cus_someone_else" })
    const res = createRes()

    await GET(req, res as never)

    expect(res.statusCode).toBe(403)
    expect(service.getProducerOrders).not.toHaveBeenCalled()
  })

  it("refuses a legacy producer with no recorded owner, rather than grandfathering", async () => {
    // actorMayManage would allow this. On a PII read it must not: a null
    // owner means ownership cannot be established, and every legacy row would
    // otherwise be readable by any account that can sign up.
    const { req, service } = makeReq({ actorId: "cus_anyone", ownerId: null })
    const res = createRes()

    await GET(req, res as never)

    expect(res.statusCode).toBe(403)
    expect(service.getProducerOrders).not.toHaveBeenCalled()
  })

  it("serves the owner their own orders", async () => {
    const { req, service } = makeReq({ actorId: "cus_owner" })
    const res = createRes()

    await GET(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(service.getProducerOrders).toHaveBeenCalled()
    expect((res.body as { orders: unknown[] }).orders).toEqual(ORDERS)
  })

  it("404s an unknown producer without revealing whether it is owned", async () => {
    const service = {
      retrieveFoodProducer: jest.fn(async () => null),
      getProducerOrders: jest.fn(),
      listFoodOrders: jest.fn(),
    }
    const req = {
      params: { id: "fp_missing" },
      query: {},
      auth_context: { actor_id: "cus_owner" },
      scope: {
        resolve: (key: string) => {
          if (key === FOOD_DISTRIBUTION_MODULE) return service
          throw new Error(`unresolvable: ${key}`)
        },
      },
    }
    const res = createRes()

    await GET(req as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(service.getProducerOrders).not.toHaveBeenCalled()
  })
})
