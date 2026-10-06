/**
 * POST /v1/integrations/blackout/link — the cross-user guard.
 *
 * A customer already linked to one Blackout member must never be re-linked to
 * another: the manage session, the entitlement grants and every outbound
 * webhook resolve a member through `customer.metadata.blackout_user_id`, so an
 * overwrite would hand member A's subscriptions to member B.
 *
 * The seller half has the same guard on `seller_metadata.blackout_user_id`
 * (a seller's payouts, listings and §3 bridge events resolve through it).
 *
 * Real code: the route and its SQL. Faked: the pg connection, as an in-memory
 * customer/seller table that interprets exactly the statements the route
 * sends (and throws on any other). The container resolves only
 * ContainerRegistrationKeys.PG_CONNECTION.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST } from "../route"
import { makeContainer } from "../../../../../../modules/subscription/__tests__/fake-subscription-service"

const SERVICE_TOKEN = "ent-service-token-1234567890"

type Customer = { id: string; metadata: Record<string, unknown> }
type Seller = { seller_id: string; mxid?: string; blackout_user_id?: string | null }

function makePg(
  customers: Customer[],
  sellers: Seller[] = [],
  opts: { racer?: string; sellerRacer?: string } = {}
) {
  const statements: string[] = []
  const raw = jest.fn(async (sql: string, b: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim()
    statements.push(s)
    if (
      s ===
      "SELECT id FROM customer WHERE metadata->>'mxid' = ? AND deleted_at IS NULL ORDER BY (COALESCE(metadata->>'blackout_user_id', '') IN ('', ?)) DESC, id LIMIT 1"
    ) {
      // The ORDER BY, interpreted: carrying the caller's id or none first
      // (true sorts before false under DESC), then the lowest id.
      const free = (x: Customer) => ["", b[1]].includes((x.metadata.blackout_user_id as string | undefined) ?? "")
      const c = customers
        .filter((x) => x.metadata.mxid === b[0])
        .sort((x, y) => Number(free(y)) - Number(free(x)) || x.id.localeCompare(y.id))[0]
      return { rows: c ? [{ id: c.id }] : [] }
    }
    if (s.startsWith("SELECT metadata->>'blackout_user_id' AS blackout_user_id FROM customer WHERE id = ?")) {
      const c = customers.find((x) => x.id === b[0])
      const seen = c ? ((c.metadata.blackout_user_id as string | undefined) ?? null) : null
      // A concurrent link by someone else lands AFTER this read returns and
      // before the route's write.
      if (c && opts.racer) c.metadata.blackout_user_id = opts.racer
      return { rows: c ? [{ blackout_user_id: seen }] : [] }
    }
    if (s.startsWith("UPDATE customer SET metadata")) {
      const [bid, cid, guard] = b as string[]
      const c = customers.find((x) => x.id === cid)
      if (!c) return { rows: [], rowCount: 0 }
      if (s.includes("IN ('', ?)")) {
        const current = (c.metadata.blackout_user_id as string | undefined) ?? ""
        if (current !== "" && current !== guard) return { rows: [], rowCount: 0 }
      }
      c.metadata = { ...c.metadata, blackout_user_id: bid }
      return { rows: [], rowCount: 1 }
    }
    if (s.startsWith("SELECT seller_id FROM seller_metadata WHERE mxid = ?")) {
      const x = sellers.find((y) => y.mxid === b[0])
      return { rows: x ? [{ seller_id: x.seller_id }] : [] }
    }
    if (s.startsWith("SELECT blackout_user_id FROM seller_metadata WHERE seller_id = ?")) {
      const x = sellers.find((y) => y.seller_id === b[0])
      const seen = x ? (x.blackout_user_id ?? null) : null
      if (x && opts.sellerRacer) x.blackout_user_id = opts.sellerRacer
      return { rows: x ? [{ blackout_user_id: seen }] : [] }
    }
    if (s.startsWith("UPDATE seller_metadata SET blackout_user_id = ?")) {
      const [bid, sid, guard] = b as string[]
      const x = sellers.find((y) => y.seller_id === sid)
      if (!x) return { rows: [], rowCount: 0 }
      if (s.includes("IN ('', ?)")) {
        const current = x.blackout_user_id ?? ""
        if (current !== "" && current !== guard) return { rows: [], rowCount: 0 }
      }
      x.blackout_user_id = bid
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`fake pg: unexpected SQL ${s}`)
  })
  return { raw, statements }
}

function makeRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number
    body: unknown
    status: (c: number) => typeof res
    json: (b: unknown) => typeof res
  }
  res.status = (c: number) => {
    res.statusCode = c
    return res
  }
  res.json = (b: unknown) => {
    res.body = b
    return res
  }
  return res
}

async function link(pg: ReturnType<typeof makePg>, body: Record<string, unknown>) {
  const req = {
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    body,
    scope: makeContainer({ [ContainerRegistrationKeys.PG_CONNECTION]: pg }),
  }
  const res = makeRes()
  await POST(req as never, res as never)
  return res
}

const FORBIDDEN = { message: "You do not have access to this record.", type: "not_allowed" }

beforeEach(() => {
  process.env.FBM_BLACKOUT_INTEGRATION = "1"
  process.env.ENTITLEMENTS_SERVICE_TOKEN = SERVICE_TOKEN
})
afterEach(() => {
  delete process.env.FBM_BLACKOUT_INTEGRATION
  delete process.env.ENTITLEMENTS_SERVICE_TOKEN
})

describe("POST blackout link — never re-links a customer to a different member", () => {
  it("refuses a customer already carrying a different blackout_user_id, writing nothing (seller included)", async () => {
    const customers = [{ id: "cus_a", metadata: { blackout_user_id: "blk_a" } }]
    const sellers: Seller[] = [{ seller_id: "sel_1", blackout_user_id: null }]
    const pg = makePg(customers, sellers)
    const res = await link(pg, { blackoutUserId: "blk_b", customerId: "cus_a", sellerId: "sel_1" })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN)
    expect(customers[0].metadata.blackout_user_id).toBe("blk_a")
    expect(sellers[0].blackout_user_id).toBeNull()
    expect(pg.statements.some((s) => s.startsWith("UPDATE"))).toBe(false)
  })

  it("refuses the same way when the customer is found by mxid", async () => {
    const customers = [{ id: "cus_a", metadata: { blackout_user_id: "blk_a", mxid: "@a:blackout" } }]
    const pg = makePg(customers)
    const res = await link(pg, { blackoutUserId: "blk_b", mxid: "@a:blackout" })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN)
    expect(customers[0].metadata.blackout_user_id).toBe("blk_a")
  })

  it("refuses when a concurrent link to someone else lands between the read and the write", async () => {
    const customers: Customer[] = [{ id: "cus_a", metadata: {} }]
    const pg = makePg(customers, [], { racer: "blk_other" })
    const res = await link(pg, { blackoutUserId: "blk_b", customerId: "cus_a" })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN)
    expect(customers[0].metadata.blackout_user_id).toBe("blk_other")
  })

  it.each([
    ["the other member's customer inserted first", ["cus_a", "cus_z"]],
    ["this member's customer inserted first", ["cus_z", "cus_a"]],
  ])(
    "two customers share the mxid, one another member's and one this member's (%s): links this member's, never refuses",
    async (_label, order) => {
      const byId: Record<string, Customer> = {
        cus_a: { id: "cus_a", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_a" } },
        cus_z: { id: "cus_z", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_b" } },
      }
      const sellers: Seller[] = [{ seller_id: "sel_1", mxid: "@m:blackout", blackout_user_id: null }]
      const pg = makePg(order.map((id) => byId[id]), sellers)
      const res = await link(pg, { blackoutUserId: "blk_b", mxid: "@m:blackout" })
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        blackoutUserId: "blk_b",
        linked: { customer: "cus_z", seller: "sel_1" },
        created: false,
      })
      expect(byId.cus_a.metadata.blackout_user_id).toBe("blk_a")
      expect(sellers[0].blackout_user_id).toBe("blk_b")
    }
  )

  it("links a customer with no Blackout id yet, as before", async () => {
    const customers: Customer[] = [{ id: "cus_a", metadata: { mxid: "@a:blackout" } }]
    const pg = makePg(customers)
    const res = await link(pg, { blackoutUserId: "blk_a", mxid: "@a:blackout" })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, blackoutUserId: "blk_a", linked: { customer: "cus_a" }, created: false })
    expect(customers[0].metadata.blackout_user_id).toBe("blk_a")
  })

  it("re-linking the SAME member is idempotent", async () => {
    const customers = [{ id: "cus_a", metadata: { blackout_user_id: "blk_a" } }]
    const pg = makePg(customers)
    const res = await link(pg, { blackoutUserId: "blk_a", customerId: "cus_a" })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, linked: { customer: "cus_a" } })
    expect(customers[0].metadata.blackout_user_id).toBe("blk_a")
  })

  it("a seller-only link is unchanged", async () => {
    const sellers: Seller[] = [{ seller_id: "sel_1", blackout_user_id: null }]
    const pg = makePg([], sellers)
    const res = await link(pg, { blackoutUserId: "blk_a", sellerId: "sel_1" })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ linked: { seller: "sel_1" } })
    expect(sellers[0].blackout_user_id).toBe("blk_a")
  })

  it("seller half: refuses a seller already carrying a different blackout_user_id, writing nothing (customer included)", async () => {
    const customers: Customer[] = [{ id: "cus_b", metadata: {} }]
    const sellers: Seller[] = [{ seller_id: "sel_1", blackout_user_id: "blk_a" }]
    const pg = makePg(customers, sellers)
    const res = await link(pg, { blackoutUserId: "blk_b", customerId: "cus_b", sellerId: "sel_1" })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN)
    expect(sellers[0].blackout_user_id).toBe("blk_a")
    expect(customers[0].metadata.blackout_user_id).toBeUndefined()
    expect(pg.statements.some((s) => s.startsWith("UPDATE"))).toBe(false)
  })

  it("seller half: refuses the same way when the seller is found by mxid", async () => {
    const sellers: Seller[] = [{ seller_id: "sel_1", mxid: "@a:blackout", blackout_user_id: "blk_a" }]
    const pg = makePg([], sellers)
    const res = await link(pg, { blackoutUserId: "blk_b", mxid: "@a:blackout" })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN)
    expect(sellers[0].blackout_user_id).toBe("blk_a")
    expect(pg.statements.some((s) => s.startsWith("UPDATE"))).toBe(false)
  })

  it("seller half: refuses when a concurrent link to someone else lands between the read and the write", async () => {
    const sellers: Seller[] = [{ seller_id: "sel_1", blackout_user_id: null }]
    const pg = makePg([], sellers, { sellerRacer: "blk_other" })
    const res = await link(pg, { blackoutUserId: "blk_b", sellerId: "sel_1" })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN)
    expect(sellers[0].blackout_user_id).toBe("blk_other")
  })

  it("seller half: re-linking the SAME member is idempotent", async () => {
    const sellers: Seller[] = [{ seller_id: "sel_1", blackout_user_id: "blk_a" }]
    const pg = makePg([], sellers)
    const res = await link(pg, { blackoutUserId: "blk_a", sellerId: "sel_1" })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, linked: { seller: "sel_1" } })
    expect(sellers[0].blackout_user_id).toBe("blk_a")
  })

  it("still requires the service token and the integration flag", async () => {
    const pg = makePg([{ id: "cus_a", metadata: {} }])
    delete process.env.FBM_BLACKOUT_INTEGRATION
    expect((await link(pg, { blackoutUserId: "blk_a", customerId: "cus_a" })).statusCode).toBe(503)
    process.env.FBM_BLACKOUT_INTEGRATION = "1"
    process.env.ENTITLEMENTS_SERVICE_TOKEN = "a-different-token-000000000"
    expect((await link(pg, { blackoutUserId: "blk_a", customerId: "cus_a" })).statusCode).toBe(401)
    expect(pg.raw).not.toHaveBeenCalled()
  })
})
