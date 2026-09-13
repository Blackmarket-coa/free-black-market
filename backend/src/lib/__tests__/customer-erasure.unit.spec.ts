import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  eraseCustomerAcrossRegistry,
  readCustomerDataAcrossRegistry,
} from "../customer-erasure"
import { CUSTOMER_DATA_REGISTRY, registryEntry } from "../customer-data-registry"

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

describe("eraseCustomerAcrossRegistry", () => {
  it("touches every entity in the registry", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    const results = await eraseCustomerAcrossRegistry(
      makeContainer({ raw }) as never,
      "cus_1"
    )

    // The registry is the contract; anything less is the old bug returning.
    expect(results).toHaveLength(CUSTOMER_DATA_REGISTRY.length)
  })

  it("deletes rows for delete entities and scopes every statement to the customer", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 2 }))
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1")

    const statements = raw.mock.calls.map((c) => c[0] as string)
    expect(statements.some((s) => /DELETE FROM "shopper_wishlist"/.test(s))).toBe(true)

    // An unscoped statement here would erase every customer's rows at once.
    for (const [sql, bindings] of raw.mock.calls) {
      expect(sql).toMatch(/WHERE "customer_id" = \?/)
      expect(bindings).toEqual(["cus_1"])
    }
  })

  it("clears the customer link on anonymise entities but keeps the row", async () => {
    const raw = jest.fn(async (_sql: string, _bindings?: unknown[]) => ({ rowCount: 1 }))
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1")

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
    await eraseCustomerAcrossRegistry(makeContainer({ raw }) as never, "cus_1")

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

  it("keeps going after one entity fails, and reports which", async () => {
    // A deletion that half-runs and says nothing is how this became a problem.
    const raw = jest.fn(async (sql: string, _bindings?: unknown[]) => {
      if (sql.includes('"volunteer_log"')) throw new Error("column missing")
      return { rowCount: 1 }
    })

    const results = await eraseCustomerAcrossRegistry(
      makeContainer({ raw }) as never,
      "cus_1"
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
        "cus_1"
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
