/**
 * resolveOrCreateCustomerForBlackoutUser — the mxid fallback never moves a
 * customer from one Blackout member to another.
 *
 * The hosted checkout resolves its buyer through this function. Before the
 * guard, a customer found by `metadata.mxid` was re-stamped with the caller's
 * `blackout_user_id` even when it already carried a DIFFERENT member's id —
 * and the manage page, grants and webhooks then treated it as the caller's.
 *
 * Real code: the function and its SQL. Faked: the pg connection, as an
 * in-memory customer table that interprets exactly the statements the
 * function sends (and throws on any other), and the customer module's
 * createCustomers. The container resolves only
 * ContainerRegistrationKeys.PG_CONNECTION and Modules.CUSTOMER (imported
 * constants) and throws on anything else.
 */
const mockWarn = jest.fn()

jest.mock("../../shared/logger", () => ({
  // Lazy: the module under test calls createLogger at import, before
  // mockWarn is initialised.
  createLogger: () => ({
    warn: (...a: unknown[]) => mockWarn(...a),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { resolveOrCreateCustomerForBlackoutUser } from "../blackout-identity"
import { makeContainer } from "../../modules/subscription/__tests__/fake-subscription-service"

type Customer = { id: string; metadata: Record<string, unknown> }

function makeFakes(customers: Customer[], opts: { racer?: string } = {}) {
  const statements: string[] = []
  const raw = jest.fn(async (sql: string, b: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim()
    statements.push(s)
    const select = /^SELECT id, metadata->>'blackout_user_id' AS blackout_user_id FROM customer WHERE metadata->>'(\w+)' = \? AND deleted_at IS NULL ORDER BY \(COALESCE\(metadata->>'blackout_user_id', ''\) IN \('', \?\)\) DESC, id LIMIT 1$/.exec(s)
    if (select) {
      const key = select[1]
      // The ORDER BY, interpreted: carrying the caller's id or none first
      // (true sorts before false under DESC), then the lowest id.
      const free = (x: Customer) => ["", b[1]].includes((x.metadata.blackout_user_id as string | undefined) ?? "")
      const c = customers
        .filter((x) => x.metadata[key] === b[0])
        .sort((x, y) => Number(free(y)) - Number(free(x)) || x.id.localeCompare(y.id))[0]
      const row = c ? { id: c.id, blackout_user_id: (c.metadata.blackout_user_id as string | undefined) ?? null } : null
      // A concurrent link by someone else lands AFTER this read returns and
      // before the function's write.
      if (c && key === "mxid" && opts.racer) c.metadata.blackout_user_id = opts.racer
      return { rows: row ? [row] : [] }
    }
    if (s.startsWith("UPDATE customer SET metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb")) {
      const [patch, cid, guard] = b as string[]
      const c = customers.find((x) => x.id === cid)
      if (!c) return { rows: [], rowCount: 0 }
      if (s.includes("IN ('', ?)")) {
        const current = (c.metadata.blackout_user_id as string | undefined) ?? ""
        if (current !== "" && current !== guard) return { rows: [], rowCount: 0 }
      }
      c.metadata = { ...c.metadata, ...(JSON.parse(patch) as Record<string, unknown>) }
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`fake pg: unexpected SQL ${s}`)
  })
  let next = 1
  const createCustomers = jest.fn(async (d: Record<string, unknown>) => {
    const row = { id: `cus_new_${next++}`, metadata: d.metadata as Record<string, unknown> }
    customers.push(row)
    return { id: row.id }
  })
  const container = makeContainer({
    [ContainerRegistrationKeys.PG_CONNECTION]: { raw },
    [Modules.CUSTOMER]: { createCustomers },
  })
  return { raw, statements, createCustomers, container, customers }
}

const updates = (statements: string[]) => statements.filter((s) => s.startsWith("UPDATE"))

beforeEach(() => mockWarn.mockReset())

describe("resolveOrCreateCustomerForBlackoutUser — mxid fallback", () => {
  it("an mxid match carrying ANOTHER member's id is no match: not re-stamped, a fresh customer is created, logged once", async () => {
    const f = makeFakes([{ id: "cus_a", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_a" } }])
    const out = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
      blackoutUserId: "blk_b",
      mxid: "@m:blackout",
    })
    expect(out).toEqual({ customerId: "cus_new_1", created: true })
    expect(f.customers[0].metadata).toEqual({ mxid: "@m:blackout", blackout_user_id: "blk_a" })
    expect(updates(f.statements)).toEqual([])
    expect(f.createCustomers).toHaveBeenCalledTimes(1)
    expect(f.createCustomers.mock.calls[0][0]).toMatchObject({
      metadata: { blackout_user_id: "blk_b", mxid: "@m:blackout", synthetic_email: true },
    })
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(String(mockWarn.mock.calls[0][0])).toContain("cus_a")
  })

  it("the member's next checkout finds the fresh customer by its own id, never the other member's", async () => {
    const f = makeFakes([{ id: "cus_a", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_a" } }])
    await resolveOrCreateCustomerForBlackoutUser(f.container as never, { blackoutUserId: "blk_b", mxid: "@m:blackout" })
    const again = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
      blackoutUserId: "blk_b",
      mxid: "@m:blackout",
    })
    expect(again).toEqual({ customerId: "cus_new_1", created: false })
    expect(f.customers[0].metadata.blackout_user_id).toBe("blk_a")
    expect(f.createCustomers).toHaveBeenCalledTimes(1)
  })

  it("an mxid match carrying no Blackout id is stamped and used, as before", async () => {
    const f = makeFakes([{ id: "cus_a", metadata: { mxid: "@m:blackout" } }])
    const out = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
      blackoutUserId: "blk_b",
      mxid: "@m:blackout",
    })
    expect(out).toEqual({ customerId: "cus_a", created: false })
    expect(f.customers[0].metadata).toEqual({ mxid: "@m:blackout", blackout_user_id: "blk_b" })
    expect(f.createCustomers).not.toHaveBeenCalled()
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it("a customer already carrying THIS member's id is used, as before", async () => {
    const f = makeFakes([{ id: "cus_a", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_b" } }])
    const out = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
      blackoutUserId: "blk_b",
      mxid: "@m:blackout",
    })
    expect(out).toEqual({ customerId: "cus_a", created: false })
    expect(f.customers[0].metadata.blackout_user_id).toBe("blk_b")
    expect(f.createCustomers).not.toHaveBeenCalled()
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it("a concurrent link to someone else between the read and the write is not overwritten: fresh customer", async () => {
    const f = makeFakes([{ id: "cus_a", metadata: { mxid: "@m:blackout" } }], { racer: "blk_other" })
    const out = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
      blackoutUserId: "blk_b",
      mxid: "@m:blackout",
    })
    expect(out).toEqual({ customerId: "cus_new_1", created: true })
    expect(f.customers[0].metadata.blackout_user_id).toBe("blk_other")
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["the other member's customer inserted first", ["cus_a", "cus_z"]],
    ["the unlinked customer inserted first", ["cus_z", "cus_a"]],
  ])(
    "two customers share the mxid, one linked to another member and one unlinked (%s): the unlinked one is used, whatever the row order",
    async (_label, order) => {
      const byId: Record<string, Customer> = {
        cus_a: { id: "cus_a", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_a" } },
        cus_z: { id: "cus_z", metadata: { mxid: "@m:blackout" } },
      }
      const f = makeFakes(order.map((id) => byId[id]))
      const out = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
        blackoutUserId: "blk_b",
        mxid: "@m:blackout",
      })
      expect(out).toEqual({ customerId: "cus_z", created: false })
      expect(byId.cus_a.metadata.blackout_user_id).toBe("blk_a")
      expect(byId.cus_z.metadata.blackout_user_id).toBe("blk_b")
      expect(f.createCustomers).not.toHaveBeenCalled()
      expect(mockWarn).not.toHaveBeenCalled()
    }
  )

  it("every mxid match linked to other members: none is re-stamped, a fresh customer is created", async () => {
    const f = makeFakes([
      { id: "cus_c", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_c" } },
      { id: "cus_a", metadata: { mxid: "@m:blackout", blackout_user_id: "blk_a" } },
    ])
    const out = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
      blackoutUserId: "blk_b",
      mxid: "@m:blackout",
    })
    expect(out).toEqual({ customerId: "cus_new_1", created: true })
    expect(f.customers.map((c) => c.metadata.blackout_user_id)).toEqual(["blk_c", "blk_a", "blk_b"])
    expect(updates(f.statements)).toEqual([])
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it("no match at all creates a customer, as before", async () => {
    const f = makeFakes([])
    const out = await resolveOrCreateCustomerForBlackoutUser(f.container as never, {
      blackoutUserId: "blk_b",
      mxid: "@m:blackout",
    })
    expect(out).toEqual({ customerId: "cus_new_1", created: true })
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
