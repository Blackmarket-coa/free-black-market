import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import run, {
  CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL,
  DELETE_ORPHANED_PASSWORD_HISTORY_SQL,
  TABLE_EXISTS_SQL,
  clearDeletedCustomersLeftovers,
} from "../clear-deleted-customers-review-names-and-password-history"

/**
 * The one-off cleanup of what deletions left before the registry reached it.
 * Its statements are run on a real database in
 * integration-tests/http/customer-data-registry.spec.ts. Here: it runs each
 * statement only when the tables that statement reads exist, so a database
 * without one of the modules does not fail `medusa db:migrate`, and it
 * resolves only the framework keys it imports.
 */

function fakePg(present: string[], counts: { reviews?: number; history?: number } = {}) {
  const calls: Array<{ sql: string; bindings?: unknown[] }> = []
  const raw = jest.fn(async (sql: string, bindings?: unknown[]) => {
    calls.push({ sql, bindings })
    if (sql === TABLE_EXISTS_SQL) return { rows: [{ present: present.includes(String(bindings?.[0])) }] }
    if (sql === CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL) return { rows: [], rowCount: counts.reviews ?? 0 }
    if (sql === DELETE_ORPHANED_PASSWORD_HISTORY_SQL) return { rows: [], rowCount: counts.history ?? 0 }
    throw new Error(`unexpected SQL: ${sql}`)
  })
  const writes = () => calls.map((c) => c.sql).filter((sql) => sql !== TABLE_EXISTS_SQL)
  return { raw, calls, writes }
}

const ALL = ["embed_product_review", "password_history_entry", "auth_identity"]

describe("clear-deleted-customers-review-names-and-password-history", () => {
  it("clears the names on unlinked reviews and deletes password history whose identity is gone", async () => {
    const pg = fakePg(ALL, { reviews: 3, history: 2 })

    await expect(clearDeletedCustomersLeftovers(pg)).resolves.toEqual({ reviewNamesCleared: 3, passwordHistoryDeleted: 2 })
    expect(pg.writes()).toEqual([CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL, DELETE_ORPHANED_PASSWORD_HISTORY_SQL])
  })

  it("asks Postgres about each table it reads, by name", async () => {
    const pg = fakePg(ALL)
    await clearDeletedCustomersLeftovers(pg)
    const asked = pg.calls.filter((c) => c.sql === TABLE_EXISTS_SQL).map((c) => c.bindings)
    expect(asked).toEqual([["embed_product_review"], ["password_history_entry"], ["auth_identity"]])
  })

  it("skips the password history when the auth module's table is missing, rather than failing the migration", async () => {
    // NOT EXISTS against a missing table would fail the whole migration.
    const pg = fakePg(["embed_product_review", "password_history_entry"])

    await expect(clearDeletedCustomersLeftovers(pg)).resolves.toEqual({ reviewNamesCleared: 0, passwordHistoryDeleted: null })
    expect(pg.writes()).toEqual([CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL])
  })

  it("skips each statement whose own table is missing", async () => {
    const noReviews = fakePg(["password_history_entry", "auth_identity"])
    await expect(clearDeletedCustomersLeftovers(noReviews)).resolves.toEqual({ reviewNamesCleared: null, passwordHistoryDeleted: 0 })
    expect(noReviews.writes()).toEqual([DELETE_ORPHANED_PASSWORD_HISTORY_SQL])

    const noHistory = fakePg(["embed_product_review", "auth_identity"])
    await expect(clearDeletedCustomersLeftovers(noHistory)).resolves.toEqual({ reviewNamesCleared: 0, passwordHistoryDeleted: null })
    expect(noHistory.writes()).toEqual([CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL])
  })

  it("touches only a review with no customer and a name, and only the name", () => {
    const sql = CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL.replace(/\s+/g, " ").trim()
    expect(sql).toBe(
      `UPDATE "embed_product_review" SET "customer_display_name" = NULL WHERE "customer_id" IS NULL AND "customer_display_name" IS NOT NULL`
    )
  })

  it("runs as a Medusa migration script, resolving only the framework keys it imports", async () => {
    const pg = fakePg(ALL, { reviews: 1, history: 4 })
    const info = jest.fn()
    const container = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
        if (key === ContainerRegistrationKeys.LOGGER) return { info }
        throw new Error(`unexpected container key: ${key}`)
      },
    } as unknown as MedusaContainer

    await run({ container })

    expect(pg.writes()).toEqual([CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL, DELETE_ORPHANED_PASSWORD_HISTORY_SQL])
    expect(info).toHaveBeenCalledWith(
      "clear-deleted-customers-review-names-and-password-history: review names cleared: 1; orphaned password history rows deleted: 4"
    )
  })
})
