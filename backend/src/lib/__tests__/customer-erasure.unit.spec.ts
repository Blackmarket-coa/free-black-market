import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  eraseCustomerAcrossRegistry,
  readCustomerDataAcrossRegistry,
} from "../customer-erasure"
import { CUSTOMER_DATA_REGISTRY, QUERY_CANNOT_ADDRESS, registryEntry } from "../customer-data-registry"

/**
 * The executor behind D11-1.
 *
 * The behaviours worth pinning are the ones that decide whether a person's
 * deletion request is honoured or quietly half-honoured.
 */

const makeContainer = (opts: {
  raw?: jest.Mock
  noPg?: boolean
  graph?: jest.Mock
}) => ({
  resolve: (key: string) => {
    if (key === ContainerRegistrationKeys.PG_CONNECTION) {
      if (opts.noPg) throw new Error("not registered")
      return {
        raw:
          opts.raw ??
          jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 })),
      }
    }
    if (key === ContainerRegistrationKeys.QUERY) {
      if (!opts.graph) throw new Error("not registered")
      return { graph: opts.graph }
    }
    throw new Error(`unresolvable: ${key}`)
  },
})

/** The sign-in identity the deletion route revokes, as it passes it. */
const IDENTITY = { authIdentityId: "authid_1" }

describe("eraseCustomerAcrossRegistry", () => {
  it("touches every entity in the registry", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    const results = await eraseCustomerAcrossRegistry(
      makeContainer({ raw }) as never,
      "cus_1",
      IDENTITY
    )

    // The registry is the contract; anything less is the old bug returning.
    expect(results).toHaveLength(CUSTOMER_DATA_REGISTRY.length)
  })

  it("deletes rows for delete entities and scopes every statement to the customer", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 2 }))
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1", IDENTITY)

    const statements = raw.mock.calls.map((c) => c[0] as string)
    expect(statements.some((s) => /DELETE FROM "shopper_wishlist"/.test(s))).toBe(true)

    // An unscoped statement here would erase every customer's rows at once.
    // The one table keyed by the sign-in identity binds that identity.
    for (const [sql, bindings] of raw.mock.calls) {
      if (sql.includes('"password_history_entry"')) {
        expect(sql).toMatch(/WHERE "auth_identity_id" = \?$/)
        expect(bindings).toEqual(["authid_1"])
        continue
      }
      expect(sql).toMatch(/WHERE "(customer_id|receiver_id)" = \?/)
      expect(bindings).toEqual(["cus_1"])
    }
    // Medusa's notification log names its customer in receiver_id.
    expect(statements).toContain('DELETE FROM "notification" WHERE "receiver_id" = ?')
  })

  it("clears the customer link on anonymise entities but keeps the row", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1", IDENTITY)

    const vote = raw.mock.calls
      .map((c) => c[0])
      .find((s) => s.includes('"garden_vote"'))

    expect(vote).toMatch(/^UPDATE/)
    expect(vote).toMatch(/"customer_id" = NULL/)
  })

  it("strips a retained food order's address but keeps its customer link", async () => {
    // The concrete case: a delivery kept the recipient's name, phone and street
    // address after they deleted their account. The order stays for accounting;
    // the address does not.
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1", IDENTITY)

    const order = raw.mock.calls
      .map((c) => c[0])
      .find((s) => s.includes('"food_order"'))

    expect(order).toMatch(/^UPDATE/)
    expect(order).toMatch(/"delivery_address_line_1" = NULL/)
    expect(order).toMatch(/"customer_phone" = NULL/)
    // Retained rows keep the foreign key: the customer row they point at is
    // itself anonymised, and orphaning the record buys nothing.
    expect(order).not.toMatch(/"customer_id" = NULL/)
  })

  it("leaves a collective backing as it is: retained with its backer_id, nothing on it to clear", async () => {
    // P1-13. The campaign's totals are summed from the row and a failed
    // campaign's refund is paid to the wallet backer_id names, so the erasure
    // reports it and issues no statement against it.
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    const results = await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1", IDENTITY)

    expect(results.find((r) => r.entity === "collective_backing")).toEqual({
      entity: "collective_backing",
      action: "retain",
      rows: 0,
    })
    expect(raw.mock.calls.some((c) => String(c[0]).includes('"collective_backing"'))).toBe(false)
  })

  it("deletes the revoked sign-in identity's old password hashes, by that identity and no other id", async () => {
    // P1-13 review: password_history_entry knows the person only by
    // auth_identity_id. The customer id would match nothing; an unscoped
    // statement would erase everyone's history.
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 3 }))
    const results = await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1", IDENTITY)

    expect(raw.mock.calls.filter(([sql]) => sql.includes('"password_history_entry"'))).toEqual([
      ['DELETE FROM "password_history_entry" WHERE "auth_identity_id" = ?', ["authid_1"]],
    ])
    expect(results.find((r) => r.entity === "password_history_entry")).toEqual({
      entity: "password_history_entry",
      action: "delete",
      rows: 3,
    })
  })

  it("reports the password history as not erased, rather than skipping it, when given no sign-in identity", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    const results = await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1")

    expect(results.find((r) => r.entity === "password_history_entry")).toEqual({
      entity: "password_history_entry",
      action: "delete",
      rows: 0,
      error: "no sign-in identity to erase by",
    })
    expect(raw.mock.calls.some(([sql]) => sql.includes('"password_history_entry"'))).toBe(false)
    // Everything keyed by the customer still runs.
    expect(results.filter((r) => r.error).map((r) => r.entity)).toEqual(["password_history_entry"])
  })

  it("unlinks a review and clears the public name it is shown under", async () => {
    // P1-13 review: the review stays for other shoppers; "Jordan R." does not.
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1", IDENTITY)

    expect(raw.mock.calls.filter(([sql]) => sql.includes('"embed_product_review"'))).toEqual([
      ['UPDATE "embed_product_review" SET "customer_id" = NULL, "customer_display_name" = NULL WHERE "customer_id" = ?', ["cus_1"]],
    ])
  })

  it("clears a retained standing order's customer notes and keeps its link", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1", IDENTITY)

    expect(raw.mock.calls.filter(([sql]) => sql.includes('"standing_order"'))).toEqual([
      ['UPDATE "standing_order" SET "customer_notes" = NULL WHERE "customer_id" = ?', ["cus_1"]],
    ])
  })

  it("keeps going after one entity fails, and reports which", async () => {
    // A deletion that half-runs and says nothing is how this became a problem.
    const raw = jest.fn(async (sql: string, _bindings?: unknown[]) => {
      if (sql.includes('"volunteer_log"')) throw new Error("column missing")
      return { rowCount: 1 }
    })

    const results = await eraseCustomerAcrossRegistry(
      makeContainer({ raw }) as never,
      "cus_1",
      IDENTITY
    )

    expect(results).toHaveLength(CUSTOMER_DATA_REGISTRY.length)
    const failed = results.filter((r) => r.error)
    expect(failed.map((f) => f.entity)).toEqual(["volunteer_log"])
    expect(results.filter((r) => !r.error).length).toBe(
      CUSTOMER_DATA_REGISTRY.length - 1
    )
  })

  it("reports every entity as unerased when there is no database", async () => {
    // Never returns a quiet success it did not earn.
    const results = await eraseCustomerAcrossRegistry(
      makeContainer({ noPg: true }) as never,
      "cus_1"
    )

    expect(results).toHaveLength(CUSTOMER_DATA_REGISTRY.length)
    expect(results.every((r) => r.error === "no database connection")).toBe(true)
    expect(results.every((r) => r.rows === 0)).toBe(true)
  })

  it("builds no SQL for an identifier that could not be a table name", async () => {
    // The registry is source, not input — but it is interpolated into SQL, so
    // a malformed entry fails loudly rather than being escaped around.
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 0 }))
    const original = registryEntry("shopper_wishlist")!
    const saved = original.entity
    ;(original as { entity: string }).entity = 'wishlist"; DROP TABLE x --'

    try {
      const results = await eraseCustomerAcrossRegistry(
        makeContainer({ raw }) as never,
        "cus_1",
        IDENTITY
      )
      const bad = results.find((r) => r.entity.includes("DROP TABLE"))
      expect(bad?.error).toMatch(/unsafe identifier/i)
      expect(
        raw.mock.calls.some((c) => String(c[0]).includes("DROP TABLE"))
      ).toBe(false)
    } finally {
      ;(original as { entity: string }).entity = saved
    }
  })
})

describe("readCustomerDataAcrossRegistry", () => {
  it("returns only entities that actually hold rows for this person", async () => {
    const graph = jest.fn(async ({ entity }: { entity: string }) => ({
      data: entity === "volunteer_log" ? [{ id: "vl_1" }] : [],
    }))

    const out = await readCustomerDataAcrossRegistry(
      makeContainer({ graph }) as never,
      "cus_1"
    )

    expect(Object.keys(out)).toEqual(["volunteer_log"])
  })

  it("reads a framework table by its own customer column", async () => {
    const graph = jest.fn(async (_q: { entity: string; filters: Record<string, unknown> }) => ({ data: [] }))
    await readCustomerDataAcrossRegistry(makeContainer({ graph }) as never, "cus_1")
    const notification = graph.mock.calls.map((c) => c[0]).find((q) => q.entity === "notification")
    expect(notification?.filters).toEqual({ receiver_id: "cus_1" })
  })

  it("reads a collective backing by backer_id, in SQL, because Query cannot address it", async () => {
    // Until the P1-13 follow-up a person's backings were missing from their
    // export entirely: the table has no customer_id. Query calls a
    // `listCollectiveBackings` the module does not have, so the entry reads
    // the table directly.
    const graph = jest.fn(async (_q: { entity: string }) => ({ data: [] }))
    const raw = jest.fn(async (sql: string, bindings?: unknown[]) =>
      sql.includes('"collective_backing"') && bindings?.[0] === "cus_1"
        ? { rows: [{ id: "cbck_1", backer_id: "cus_1" }] }
        : { rows: [] }
    )
    const out = await readCustomerDataAcrossRegistry(makeContainer({ graph, raw }) as never, "cus_1")

    expect(raw.mock.calls.filter(([sql]) => sql.includes('"collective_backing"'))).toEqual([
      ['SELECT * FROM "collective_backing" WHERE "backer_id" = ?', ["cus_1"]],
    ])
    expect(graph.mock.calls.some(([q]) => q.entity === "collective_backing")).toBe(false)
    expect(out.collective_backing).toEqual([{ id: "cbck_1", backer_id: "cus_1" }])
  })

  it("reads every table Query cannot address by SQL on its own customer column, and nothing else", async () => {
    // The P1-13 review: twelve more entries put `_error` in every export on
    // Postgres for the same reason as the backing. Each is one SELECT scoped
    // to the person; every other entry still goes through Query.
    const graph = jest.fn(async (_q: { entity: string }) => ({ data: [] }))
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rows: [] }))
    await readCustomerDataAcrossRegistry(makeContainer({ graph, raw }) as never, "cus_1")

    const sqlEntries = CUSTOMER_DATA_REGISTRY.filter((e) => e.exportVia === "sql")
    expect(sqlEntries.map((e) => e.entity).sort()).toEqual(Object.keys(QUERY_CANNOT_ADDRESS).sort())
    expect(raw.mock.calls).toEqual(
      sqlEntries.map((e) => [
        `SELECT * FROM "${e.entity}" WHERE "${e.customerColumn ?? "customer_id"}" = ?`,
        ["cus_1"],
      ])
    )
    const graphed = graph.mock.calls.map(([q]) => q.entity)
    expect(graphed.filter((entity) => entity in QUERY_CANNOT_ADDRESS)).toEqual([])
    expect(graphed).toHaveLength(CUSTOMER_DATA_REGISTRY.filter((e) => e.inExport !== false).length - sqlEntries.length)
  })

  it("reports a SQL-read entity in place when there is no database", async () => {
    const graph = jest.fn(async (_q: { entity: string }) => ({ data: [] }))
    const container = makeContainer({ graph })
    const withoutPg = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) throw new Error("not registered")
        return container.resolve(key)
      },
    }
    const out = await readCustomerDataAcrossRegistry(withoutPg as never, "cus_1")
    expect(JSON.stringify(out.collective_backing)).toMatch(/could not be read: no database connection/)
  })

  it("reports an unreadable entity in place rather than omitting it", async () => {
    // A gap in an export the person is told is complete must be visible to
    // them, not silently absent.
    const graph = jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "garden_membership") throw new Error("table gone")
      return { data: [] }
    })

    const out = await readCustomerDataAcrossRegistry(
      makeContainer({ graph }) as never,
      "cus_1"
    )

    expect(JSON.stringify(out.garden_membership)).toMatch(/could not be read/i)
  })
})
