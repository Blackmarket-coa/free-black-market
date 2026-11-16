/**
 * What `PUT /store/food-producers/:id` tells its caller (SD-110 follow-up).
 *
 * `GET /store/food-producers/:id` keeps a producer's street lines and
 * coordinates back from every caller when `hide_address` is set. The PUT
 * echoed the row whole, and `actorMayManage` lets any signed-in account
 * write a producer with no owner on record. Seen on Postgres: such an
 * account's GET answered with `address_line_1` and `latitude` null, and its
 * empty PUT answered with both.
 *
 * `integration-tests/http/store-food-network-owner-reads.spec.ts` has the
 * same through the real middleware and tables.
 */
import { GET as getProducer, PUT as updateProducer } from "../[id]/route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"

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

/** A cottage-food producer working from home, as the table holds it. */
const HOME = {
  id: "prd_1",
  name: "Home Kitchen",
  hide_address: true,
  address_line_1: "5 Hidden Home St",
  address_line_2: "Rear flat",
  city: "Springfield",
  postal_code: "62701",
  latitude: 41.123456,
  longitude: -87.654321,
  operating_status: "OPEN",
  owner_id: "cus_owner" as string | null,
}
/** What `hide_address` keeps back. */
const DOORSTEP = ["5 Hidden Home St", "Rear flat", "41.123456", "-87.654321"]

const setup = (opts: { actorId?: string; producer?: Record<string, unknown>; body?: Record<string, unknown> }) => {
  const row = opts.producer ?? HOME
  const service = {
    retrieveFoodProducer: jest.fn(async () => row),
    isProducerOpen: jest.fn(async () => true),
    // Answers with the row as stored, the way the module does.
    updateFoodProducers: jest.fn(async (data: Record<string, unknown>) => ({ ...row, ...data })),
  }
  const req = {
    params: { id: "prd_1" },
    query: {},
    body: opts.body ?? {},
    ...(opts.actorId ? { auth_context: { actor_id: opts.actorId, actor_type: "customer" } } : {}),
    scope: {
      resolve: (key: string) => {
        if (key === FOOD_DISTRIBUTION_MODULE) return service
        throw new Error(`unresolvable: ${String(key)}`)
      },
    },
  }
  return { req: req as never, service, res: createRes() }
}
const producerOf = (res: Res) => (res.body as { producer: Record<string, unknown> }).producer

describe("PUT /store/food-producers/:id — what the write tells its caller", () => {
  it("acknowledges a write on a producer with no recorded owner without the address it hides", async () => {
    const { req, res, service } = setup({
      actorId: "cus_anyone",
      producer: { ...HOME, owner_id: null },
      body: {},
    })

    await updateProducer(req, res as never)

    expect(res.statusCode).toBe(200)
    // The write itself is still let through (grandfathered).
    expect(service.updateFoodProducers).toHaveBeenCalledWith({ id: "prd_1" })
    expect(producerOf(res)).toMatchObject({
      id: "prd_1",
      address_line_1: null,
      address_line_2: null,
      latitude: null,
      longitude: null,
      // Roughly where, as on GET: the flag hides the doorstep, not the town.
      city: "Springfield",
      postal_code: "62701",
    })
    const body = JSON.stringify(res.body)
    for (const value of DOORSTEP) {
      expect([value, body.includes(value)]).toEqual([value, false])
    }
  })

  it("answers such a caller with what GET serves", async () => {
    const legacy = { ...HOME, owner_id: null }
    const read = setup({ actorId: "cus_anyone", producer: legacy })
    await getProducer(read.req, read.res as never)
    const write = setup({ actorId: "cus_anyone", producer: legacy, body: {} })
    await updateProducer(write.req, write.res as never)

    const { is_currently_open: _open, ...served } = producerOf(read.res)
    expect(producerOf(write.res)).toEqual(served)
  })

  it("does not echo back a street line the caller has just written onto such a producer", async () => {
    // The write is still theirs to make (the operator's ruling); the answer
    // is the same projection whatever the row now holds.
    const { req, res, service } = setup({
      actorId: "cus_anyone",
      producer: { ...HOME, owner_id: null },
      body: { address_line_1: "1 Somewhere Else" },
    })

    await updateProducer(req, res as never)

    expect(service.updateFoodProducers).toHaveBeenCalledWith({ id: "prd_1", address_line_1: "1 Somewhere Else" })
    expect(producerOf(res).address_line_1).toBeNull()
  })

  it("echoes the row whole to the producer's recorded owner", async () => {
    const { req, res } = setup({ actorId: "cus_owner", body: { description: "open late" } })

    await updateProducer(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(producerOf(res)).toMatchObject({
      id: "prd_1",
      description: "open late",
      address_line_1: "5 Hidden Home St",
      address_line_2: "Rear flat",
      latitude: 41.123456,
      longitude: -87.654321,
    })
  })

  it("echoes an address that is not hidden, as GET publishes it", async () => {
    const { req, res } = setup({
      actorId: "cus_anyone",
      producer: { ...HOME, owner_id: null, hide_address: false },
      body: {},
    })

    await updateProducer(req, res as never)

    expect(producerOf(res)).toMatchObject({ address_line_1: "5 Hidden Home St", latitude: 41.123456 })
  })

  it("still refuses a producer with another owner, and writes nothing", async () => {
    const { req, res, service } = setup({ actorId: "cus_someone_else", body: { description: "mine now" } })

    await updateProducer(req, res as never)

    expect([res.statusCode, res.body]).toEqual([403, { message: "This producer is not yours to manage" }])
    expect(service.updateFoodProducers).not.toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toContain("Hidden Home")
  })
})
