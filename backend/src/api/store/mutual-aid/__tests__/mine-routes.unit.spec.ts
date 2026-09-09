import { GET as MY_REQUESTS } from "../requests/mine/route"
import { GET as MY_OFFERS } from "../offers/mine/route"
import { MUTUAL_AID_MODULE } from "../../../../modules/mutual-aid"
import aidMiddlewares from "../middlewares"

/**
 * `/store/mutual-aid/{requests,offers}/mine` — the only two non-public reads on
 * this surface.
 *
 * They exist because of a gap the withdraw endpoint opened: `toPublicAid`
 * withholds `requester_id` and `offerer_id`, correctly, which also meant a
 * person had no way to find the row they posted. There was a way to take an ask
 * down and nothing that would give you its id.
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

const ROW = {
  id: "mar_1",
  requester_id: "cus_me",
  offerer_id: "cus_me",
  title: "Ride to a dialysis appointment",
  description: "Tuesdays and Thursdays",
  category: "transport",
  status: "MATCHED",
  urgency: "URGENT",
  latitude: 42.3314,
  longitude: -83.0458,
  locality: "Southwest Detroit",
  needed_by: new Date("2026-12-01T00:00:00.000Z"),
  matched_at: new Date("2026-09-08T15:00:00.000Z"),
  matched_helper_id: "cus_helper",
  metadata: { note: "third floor, no lift" },
  created_at: new Date("2026-09-08T11:00:00.000Z"),
}

const makeService = (rows: Array<Record<string, unknown>> = [ROW]) => ({
  listMutualAidRequests: jest.fn(async (_f: Record<string, unknown>) => rows),
  listMutualAidOffers: jest.fn(async (_f: Record<string, unknown>) => rows),
})

type Service = ReturnType<typeof makeService>

const makeReq = (service: Service, customerId: string | undefined) => ({
  params: {},
  query: {},
  body: undefined,
  auth_context: customerId ? { actor_id: customerId } : undefined,
  scope: {
    resolve: (key: string) =>
      key === MUTUAL_AID_MODULE || key === "mutualAidModuleService"
        ? service
        : undefined,
  },
})

type Args = Parameters<typeof MY_REQUESTS>

const call = async (
  handler: typeof MY_REQUESTS,
  service: Service,
  customerId: string | undefined
) => {
  const res = createRes()
  await handler(
    makeReq(service, customerId) as unknown as Args[0],
    res as unknown as Args[1]
  )
  return res
}

const SURFACES: Array<[string, typeof MY_REQUESTS, keyof Service, string]> = [
  ["requests", MY_REQUESTS, "listMutualAidRequests", "requester_id"],
  ["offers", MY_OFFERS as typeof MY_REQUESTS, "listMutualAidOffers", "offerer_id"],
]

describe.each(SURFACES)("GET /store/mutual-aid/%s/mine", (name, handler, method, idField) => {
  it("401s without an authenticated customer", async () => {
    const service = makeService()
    const res = await call(handler, service, undefined)

    expect(res.statusCode).toBe(401)
    expect(service[method]).not.toHaveBeenCalled()
  })

  it("scopes the query to the caller, in the query itself", async () => {
    // The filter IS the authorisation, so it has to be what the database is
    // asked rather than something applied to a wider result.
    const service = makeService()
    await call(handler, service, "cus_me")

    expect(service[method]).toHaveBeenCalledWith({ [idField]: "cus_me" })
  })

  it("returns every status, not just the open ones", async () => {
    // "Your asks" that hid the withdrawn and expired ones would suggest they
    // had vanished rather than closed.
    const service = makeService()
    await call(handler, service, "cus_me")

    const [filters] = service[method].mock.calls[0]
    expect(filters).not.toHaveProperty("status")
  })

  it("shows the owner the three management fields the board withholds", async () => {
    const service = makeService()
    const res = await call(handler, service, "cus_me")
    const row = (res.body as Record<string, Array<Record<string, unknown>>>)[name][0]

    expect(row).toMatchObject({
      urgency: "URGENT",
      needed_by: "2026-12-01T00:00:00.000Z",
      matched_at: "2026-09-08T15:00:00.000Z",
      status: "MATCHED",
    })
  })

  it("still never echoes coordinates back, even to the poster", async () => {
    // W5-3 is a permanent scope exclusion, not a default: mutual-aid
    // coordinates never leave the server, on any path, for anyone. The owner
    // already knows where they are.
    const service = makeService()
    const res = await call(handler, service, "cus_me")

    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain("42.33")
    expect(serialized).not.toContain("-83.04")
    expect(serialized).not.toContain("cus_helper")
    expect(serialized).not.toContain("third floor")
  })

  it("returns an empty list rather than 404 for someone with no rows", async () => {
    const service = makeService([])
    const res = await call(handler, service, "cus_new")

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ count: 0 })
  })

  it("500s on an unexpected failure without leaking the message", async () => {
    const service = {
      listMutualAidRequests: jest.fn(async () => {
        throw new Error("relation does not exist")
      }),
      listMutualAidOffers: jest.fn(async () => {
        throw new Error("relation does not exist")
      }),
    }
    const res = await call(handler, service as unknown as Service, "cus_me")

    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain("relation does not exist")
  })
})

describe("middleware registration", () => {
  it("authenticates both mine reads — the only non-public GETs here", () => {
    // Every other read on this surface is deliberately public. These two return
    // a named person's own rows, so a missing matcher would publish them.
    const middlewares = aidMiddlewares as {
      routes: Array<{
        matcher: string
        methods?: string[]
        middlewares: unknown[]
      }>
    }

    const authedGets = middlewares.routes
      .filter((r) => r.methods?.includes("GET") && r.middlewares.length > 0)
      .map((r) => r.matcher)

    expect(authedGets).toEqual([
      "/store/mutual-aid/requests/mine",
      "/store/mutual-aid/offers/mine",
    ])
  })
})
