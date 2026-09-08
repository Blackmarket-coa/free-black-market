import { POST as WITHDRAW_REQUEST } from "../requests/[id]/withdraw/route"
import { POST as WITHDRAW_OFFER } from "../offers/[id]/withdraw/route"
import { MUTUAL_AID_MODULE } from "../../../../modules/mutual-aid"
import aidMiddlewares from "../middlewares"

/**
 * `/store/mutual-aid/{requests,offers}/:id/withdraw` — the first writers of
 * `WITHDRAWN` on either enum (`docs/CDFI_COOP_ROADMAP.md` §3.8).
 *
 * The routes are thin: ownership and the legal transitions are the service's,
 * because both are also reachable from the sweep. What is asserted here is the
 * status mapping, which is the part a caller sees — a refusal to withdraw an
 * already-dispatched commitment is the caller's state (409), not a fault (400)
 * and not a missing row (404).
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

const makeService = (error?: Error) => ({
  withdrawRequest: jest.fn(async (id: string, _actor: string) => {
    if (error) throw error
    return { id, status: "WITHDRAWN" }
  }),
  withdrawOffer: jest.fn(async (id: string, _actor: string) => {
    if (error) throw error
    return { id, status: "WITHDRAWN" }
  }),
})

type Service = ReturnType<typeof makeService>

const makeReq = (service: Service, actorId: string | undefined) => ({
  params: { id: "aid_1" },
  query: {},
  body: undefined,
  auth_context: actorId ? { actor_id: actorId } : undefined,
  scope: {
    resolve: (key: string) =>
      key === MUTUAL_AID_MODULE || key === "mutualAidModuleService"
        ? service
        : undefined,
  },
})

type Args = Parameters<typeof WITHDRAW_REQUEST>

const call = async (
  handler: typeof WITHDRAW_REQUEST,
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

const HANDLERS: Array<[string, typeof WITHDRAW_REQUEST, keyof Service]> = [
  ["request", WITHDRAW_REQUEST, "withdrawRequest"],
  ["offer", WITHDRAW_OFFER as typeof WITHDRAW_REQUEST, "withdrawOffer"],
]

describe.each(HANDLERS)("%s withdraw", (_name, handler, method) => {
  it("401s without an authenticated customer", async () => {
    const service = makeService()
    const res = await call(handler, service, undefined)

    expect(res.statusCode).toBe(401)
    expect(service[method]).not.toHaveBeenCalled()
  })

  it("passes the session actor to the service, never a body field", async () => {
    // Ownership is decided by who is signed in. The id in the path names the
    // row; it does not name the actor.
    const service = makeService()
    const res = await call(handler, service, "cus_me")

    expect(res.statusCode).toBe(200)
    expect(service[method]).toHaveBeenCalledWith("aid_1", "cus_me")
    expect(res.body).toMatchObject({ withdrawn: true, status: "WITHDRAWN" })
  })

  it("404s an unknown row", async () => {
    const service = makeService(new Error("Aid request not found"))
    const res = await call(handler, service, "cus_me")

    expect(res.statusCode).toBe(404)
  })

  it("409s a transition the lifecycle does not allow", async () => {
    const service = makeService(
      new Error('Cannot withdraw a request with status "FULFILLED"')
    )
    const res = await call(handler, service, "cus_me")

    expect(res.statusCode).toBe(409)
  })

  it("500s nothing — an unexpected failure is still a 400 with its message", async () => {
    // These routes surface the service's own message; there is no state the
    // caller could be told about beyond it.
    const service = makeService(new Error("database is on fire"))
    const res = await call(handler, service, "cus_me")

    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ error: "database is on fire" })
  })
})

describe("ownership refusals map to 403", () => {
  it("request withdraw 403s a non-requester", async () => {
    const service = makeService(
      new Error("Only the requester can withdraw this request")
    )
    const res = await call(WITHDRAW_REQUEST, service, "cus_helper")

    expect(res.statusCode).toBe(403)
  })

  it("offer withdraw 403s a non-offerer", async () => {
    const service = makeService(
      new Error("Only the offerer can withdraw this offer")
    )
    const res = await call(
      WITHDRAW_OFFER as typeof WITHDRAW_REQUEST,
      service,
      "cus_someone"
    )

    expect(res.statusCode).toBe(403)
  })
})

describe("middleware registration", () => {
  it("authenticates both new withdraw matchers", () => {
    // The 401 above is the route's own belt; the middleware is the braces. A
    // route file added without its matcher entry is reachable unauthenticated,
    // and `auth_context` would simply be absent — which is indistinguishable
    // from a signed-out caller until someone forgets the belt.
    // `defineMiddlewares` normalises the singular `method` it is given into a
    // `methods` array, so read the shape it produces rather than the one the
    // file is written in.
    const middlewares = aidMiddlewares as {
      routes: Array<{
        matcher: string
        methods?: string[]
        middlewares: unknown[]
      }>
    }

    const matchers = middlewares.routes
      .filter((r) => r.methods?.includes("POST") && r.middlewares.length > 0)
      .map((r) => r.matcher)

    expect(matchers).toContain("/store/mutual-aid/requests/*/withdraw")
    expect(matchers).toContain("/store/mutual-aid/offers/*/withdraw")
  })
})
