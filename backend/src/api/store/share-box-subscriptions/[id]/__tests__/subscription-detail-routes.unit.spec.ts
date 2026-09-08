import { GET, DELETE } from "../route"
import { POST as PAUSE } from "../pause/route"
import { POST as RESUME } from "../resume/route"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"

/**
 * `/store/share-box-subscriptions/:id` and its pause/resume children.
 *
 * Ownership is matched on `customer_id` only. `customer_external_id` is the
 * Matrix-side identity and is never what a store session authenticates as, so
 * accepting it would let a caller reach a row they did not create.
 *
 * The cancelled-state guards are the other point: `pauseShareBoxSubscription`
 * and `resumeShareBoxSubscription` both write `status` unconditionally, so
 * without the guards either would quietly resurrect a cancelled subscription —
 * and `resume` would leave `cancelled_at`/`cancelled_reason` in place while
 * doing it.
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

const SUB = { id: "sbs_1", customer_id: "cus_me", status: "active" }

type Overrides = { subscription?: Record<string, unknown> | null }

const makeService = (o: Overrides = {}) => ({
  retrieveShareBoxSubscription: jest.fn(async (_id: string) => {
    if (o.subscription === null) throw new Error("not found")
    return o.subscription ?? SUB
  }),
  pauseShareBoxSubscription: jest.fn(
    async (id: string, until?: Date | null) => ({ id, status: "paused", until })
  ),
  resumeShareBoxSubscription: jest.fn(async (id: string) => ({
    id,
    status: "active",
  })),
  cancelShareBoxSubscription: jest.fn(async (id: string, reason?: string) => ({
    id,
    status: "cancelled",
    cancelled_reason: reason ?? null,
  })),
})

type Service = ReturnType<typeof makeService>

const makeReq = (
  service: Service,
  customerId: string | undefined,
  extra: { body?: unknown; query?: Record<string, unknown> } = {}
) => ({
  params: { id: "sbs_1" },
  query: extra.query ?? {},
  body: extra.body,
  auth_context: customerId ? { actor_id: customerId } : undefined,
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
  customerId: string | undefined,
  extra: { body?: unknown; query?: Record<string, unknown> } = {}
) => {
  const res = createRes()
  await handler(
    makeReq(service, customerId, extra) as unknown as Args[0],
    res as unknown as Args[1]
  )
  return res
}

const HANDLERS: Array<[string, typeof GET]> = [
  ["GET", GET],
  ["DELETE", DELETE],
  ["pause", PAUSE as typeof GET],
  ["resume", RESUME as typeof GET],
]

describe("subscription ownership gate", () => {
  it.each(HANDLERS)("%s 401s without an authenticated customer", async (_n, h) => {
    const service = makeService()
    const res = await call(h, service, undefined)
    expect(res.statusCode).toBe(401)
  })

  it.each(HANDLERS)("%s 404s another customer's subscription", async (_n, h) => {
    const service = makeService({
      subscription: { ...SUB, customer_id: "cus_other" },
    })
    const res = await call(h, service, "cus_me")
    expect(res.statusCode).toBe(404)
    expect(service.pauseShareBoxSubscription).not.toHaveBeenCalled()
    expect(service.resumeShareBoxSubscription).not.toHaveBeenCalled()
    expect(service.cancelShareBoxSubscription).not.toHaveBeenCalled()
  })

  it.each(HANDLERS)("%s 404s a subscription that does not exist", async (_n, h) => {
    const service = makeService({ subscription: null })
    const res = await call(h, service, "cus_me")
    expect(res.statusCode).toBe(404)
  })

  it("does not match on customer_external_id", async () => {
    // The Matrix-side identity is not what a store session authenticates as.
    const service = makeService({
      subscription: {
        id: "sbs_1",
        customer_id: null,
        customer_external_id: "@me:example.org",
        status: "active",
      },
    })
    const res = await call(GET, service, "@me:example.org")
    expect(res.statusCode).toBe(404)
  })
})

describe("GET /store/share-box-subscriptions/:id", () => {
  it("returns the caller's own subscription", async () => {
    const service = makeService()
    const res = await call(GET, service, "cus_me")
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ share_box_subscription: SUB })
  })
})

describe("DELETE /store/share-box-subscriptions/:id", () => {
  it("cancels with a reason from the body", async () => {
    const service = makeService()
    await call(DELETE, service, "cus_me", { body: { reason: "moving away" } })
    expect(service.cancelShareBoxSubscription).toHaveBeenCalledWith(
      "sbs_1",
      "moving away"
    )
  })

  it("accepts the reason from the query string too", async () => {
    const service = makeService()
    await call(DELETE, service, "cus_me", { query: { reason: "too much food" } })
    expect(service.cancelShareBoxSubscription).toHaveBeenCalledWith(
      "sbs_1",
      "too much food"
    )
  })

  it("cancels without a reason", async () => {
    const service = makeService()
    const res = await call(DELETE, service, "cus_me")
    expect(res.statusCode).toBe(200)
    expect(service.cancelShareBoxSubscription).toHaveBeenCalledWith(
      "sbs_1",
      undefined
    )
  })
})

describe("pause", () => {
  it("pauses indefinitely when no date is given", async () => {
    const service = makeService()
    const res = await call(PAUSE as typeof GET, service, "cus_me", { body: {} })
    expect(res.statusCode).toBe(200)
    expect(service.pauseShareBoxSubscription).toHaveBeenCalledWith("sbs_1", null)
  })

  it("pauses until a given date", async () => {
    const service = makeService()
    await call(PAUSE as typeof GET, service, "cus_me", {
      body: { until: "2027-01-01T00:00:00.000Z" },
    })
    const [, until] = service.pauseShareBoxSubscription.mock.calls[0]
    expect((until as Date).toISOString()).toBe("2027-01-01T00:00:00.000Z")
  })

  it("400s an unparseable date rather than storing Invalid Date", async () => {
    const service = makeService()
    const res = await call(PAUSE as typeof GET, service, "cus_me", {
      body: { until: "next tuesday-ish" },
    })
    expect(res.statusCode).toBe(400)
    expect(service.pauseShareBoxSubscription).not.toHaveBeenCalled()
  })

  it("409s on a cancelled subscription rather than resurrecting it", async () => {
    const service = makeService({ subscription: { ...SUB, status: "cancelled" } })
    const res = await call(PAUSE as typeof GET, service, "cus_me", { body: {} })
    expect(res.statusCode).toBe(409)
    expect(service.pauseShareBoxSubscription).not.toHaveBeenCalled()
  })
})

describe("resume", () => {
  it("resumes a paused subscription", async () => {
    const service = makeService({ subscription: { ...SUB, status: "paused" } })
    const res = await call(RESUME as typeof GET, service, "cus_me")
    expect(res.statusCode).toBe(200)
    expect(service.resumeShareBoxSubscription).toHaveBeenCalledWith("sbs_1")
  })

  it("409s on a cancelled subscription", async () => {
    // resumeShareBoxSubscription leaves cancelled_at/cancelled_reason set, so
    // it would read `active` while still carrying why it was ended.
    const service = makeService({ subscription: { ...SUB, status: "cancelled" } })
    const res = await call(RESUME as typeof GET, service, "cus_me")
    expect(res.statusCode).toBe(409)
    expect(service.resumeShareBoxSubscription).not.toHaveBeenCalled()
  })
})
