/**
 * Data-export route tests.
 *
 * The exit right is the strongest governance guarantee FBM currently offers
 * (`docs/MEMBER_GOVERNANCE.md`), and a right nobody checks is a norm. This
 * covers the customer half of it: the CCPA/CPRA "right to know" export.
 * docs/TRANSMUTATION_STRATEGY.md §5.3.
 */
import { GET } from "../route"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  res.send = (payload: any) => {
    res.body = payload
    return res
  }
  res.setHeader = (name: string, value: string) => {
    res.headers[name] = value
    return res
  }
  return res
}

const CUSTOMER = {
  id: "cus_1",
  email: "member@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
  phone: "+15550000000",
  company_name: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  metadata: { stance: "producer" },
  addresses: [{ id: "addr_1", city: "Oakland" }],
}

const ORDERS = [
  { id: "order_1", display_id: 1, status: "completed", total: 2500 },
  { id: "order_2", display_id: 2, status: "pending", total: 900 },
]

/**
 * `query.graph` is called once per section. Either entry may be a value to
 * return or an Error to throw, so a test can fail one section in isolation.
 */
const makeReq = (
  opts: {
    actorId?: string | undefined
    customer?: unknown | Error
    orders?: unknown[] | Error
  } = {}
) => {
  // `in`, not a destructuring default: a default fires on an explicit
  // `undefined` too, which would silently turn the "no actor" case into an
  // authenticated one.
  const actorId = "actorId" in opts ? opts.actorId : "cus_1"
  const { customer = CUSTOMER, orders = ORDERS } = opts

  const graph = jest.fn(async (args: { entity: string; filters?: unknown }) => {
    const { entity } = args
    if (entity === "customer") {
      if (customer instanceof Error) throw customer
      return { data: customer === null ? [] : [customer] }
    }
    if (entity === "order") {
      if (orders instanceof Error) throw orders
      return { data: orders }
    }
    throw new Error(`unexpected entity: ${entity}`)
  })

  return {
    req: {
      auth_context: actorId ? { actor_id: actorId } : undefined,
      scope: {
        resolve: (key: string) => {
          if (key === "query") return { graph }
          throw new Error(`unresolvable: ${key}`)
        },
      },
    } as any,
    graph,
  }
}

describe("GET /store/customers/me/data-export", () => {
  it("returns the customer's profile, addresses and orders as a JSON attachment", async () => {
    const { req } = makeReq()
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.headers["Content-Type"]).toBe("application/json; charset=utf-8")
    expect(res.headers["Content-Disposition"]).toBe(
      'attachment; filename="fbm-data-export-cus_1.json"'
    )

    const payload = JSON.parse(res.body)
    expect(payload.customer).toEqual(CUSTOMER)
    expect(payload.customer.addresses).toHaveLength(1)
    expect(payload.orders).toEqual(ORDERS)
    expect(payload.order_count).toBe(2)
    expect(payload.generated_at).toEqual(expect.any(String))
    expect(payload.notice).toMatch(/personal data/i)
  })

  it("scopes strictly to the authenticated actor, never a client-supplied id", async () => {
    const { req, graph } = makeReq({ actorId: "cus_authenticated" })
    // A caller trying to read someone else's data.
    ;(req as any).query = { customer_id: "cus_someone_else" }
    ;(req as any).body = { customer_id: "cus_someone_else" }
    ;(req as any).params = { id: "cus_someone_else" }

    await GET(req, createRes())

    for (const call of graph.mock.calls) {
      const filters = JSON.stringify(call[0].filters)
      expect(filters).toContain("cus_authenticated")
      expect(filters).not.toContain("cus_someone_else")
    }
  })

  it.each([undefined, "usr_1", "vendor_1", ""])(
    "refuses an actor id of %p with 401",
    async (actorId) => {
      const { req, graph } = makeReq({ actorId: actorId as string | undefined })
      const res = createRes()

      await GET(req, res)

      expect(res.statusCode).toBe(401)
      expect(graph).not.toHaveBeenCalled()
    }
  )

  it("404s rather than exporting an empty shell when the customer is gone", async () => {
    const { req } = makeReq({ customer: null })
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(404)
  })

  it("still exports the profile when the order lookup fails", async () => {
    // Each section is fetched defensively: a schema gap in one area should
    // yield a usable export, not a 500 that leaves the member with nothing.
    const { req } = makeReq({ orders: new Error("order schema drift") })
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(200)
    const payload = JSON.parse(res.body)
    expect(payload.customer).toEqual(CUSTOMER)
    expect(payload.orders).toEqual([])
    expect(payload.order_count).toBe(0)
  })

  it("404s when the customer lookup itself fails", async () => {
    const { req } = makeReq({ customer: new Error("customer schema drift") })
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(404)
  })
})
