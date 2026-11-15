import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * One-off: clear what account deletions left behind before the registry
 * reached it (P1-13 review).
 *
 * Until then POST /store/customers/me/deletion set a review's `customer_id` to
 * NULL and kept its `customer_display_name`, and deleted the person's auth
 * identity and kept their `password_history_entry` rows. The registry now
 * clears both on every new deletion. This clears them for the people who had
 * already left: their reviews still showed their public name, and their old
 * password hashes were still stored.
 *
 * Reviews: `customer_id IS NULL AND customer_display_name IS NOT NULL`
 * selects exactly the reviews of customers already deleted. The only writer of
 * `customer_display_name` is POST /store/reviews, and it always sets
 * `customer_id` as well. The only rows created without a `customer_id` are
 * service-contract reviews (the vendor route and
 * Migration20260830ReviewsAbsorption), and neither sets a display name. The
 * only thing that sets `customer_id` to NULL is the erasure. Body, title and
 * rating are kept, as on a new deletion, and the review routes show "Verified
 * buyer".
 *
 * Password history: the rows whose auth identity no longer exists. The
 * deletion route removes the identity with `deleteAuthIdentities`, a hard
 * delete, and nothing else in this codebase, Medusa's core flows or Mercur
 * deletes one. A row whose identity is gone can never be checked again,
 * because the reuse check looks history up by the identity of the password
 * being changed, so deleting it loses nothing. Rows of every actor type go,
 * as on a new deletion. A soft-deleted identity still exists here, and its
 * history is kept.
 *
 * Each statement runs only if the tables it reads exist (`to_regclass`), so a
 * database without a module skips that statement instead of failing the
 * migration. Both are idempotent. Medusa runs each migration script once,
 * after every module migration, on `medusa db:migrate` (`script_migrations`).
 * Not covered: a deletion handled by the previous release after this ran
 * (the deploy window); rerunning the two statements clears it.
 */
export const CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL = `
  UPDATE "embed_product_review"
  SET "customer_display_name" = NULL
  WHERE "customer_id" IS NULL
    AND "customer_display_name" IS NOT NULL
`

export const DELETE_ORPHANED_PASSWORD_HISTORY_SQL = `
  DELETE FROM "password_history_entry" AS "p"
  WHERE NOT EXISTS (
    SELECT 1 FROM "auth_identity" AS "a" WHERE "a"."id" = "p"."auth_identity_id"
  )
`

export const TABLE_EXISTS_SQL = `SELECT to_regclass(?::text) IS NOT NULL AS "present"`

type Pg = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: Array<Record<string, unknown>>; rowCount?: number | null }>
}
type Logger = { info: (message: string) => void }

/** Rows changed by each statement; null where a table it needs is missing. */
export type DeletedCustomersCleanup = {
  reviewNamesCleared: number | null
  passwordHistoryDeleted: number | null
}

async function tablesExist(pg: Pg, tables: string[]): Promise<boolean> {
  for (const table of tables) {
    const { rows } = await pg.raw(TABLE_EXISTS_SQL, [table])
    if (rows?.[0]?.present !== true) return false
  }
  return true
}

export async function clearDeletedCustomersLeftovers(pg: Pg): Promise<DeletedCustomersCleanup> {
  const result: DeletedCustomersCleanup = { reviewNamesCleared: null, passwordHistoryDeleted: null }
  if (await tablesExist(pg, ["embed_product_review"])) {
    result.reviewNamesCleared = (await pg.raw(CLEAR_DELETED_CUSTOMERS_REVIEW_NAMES_SQL)).rowCount ?? 0
  }
  if (await tablesExist(pg, ["password_history_entry", "auth_identity"])) {
    result.passwordHistoryDeleted = (await pg.raw(DELETE_ORPHANED_PASSWORD_HISTORY_SQL)).rowCount ?? 0
  }
  return result
}

const counted = (n: number | null, what: string, missing: string) =>
  n === null ? `skipped ${what} (${missing} does not exist)` : `${what}: ${n}`

export default async function clearDeletedCustomersReviewNamesAndPasswordHistory({
  container,
}: {
  container: MedusaContainer
}): Promise<void> {
  const pg = container.resolve<Pg>(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const { reviewNamesCleared, passwordHistoryDeleted } = await clearDeletedCustomersLeftovers(pg)
  logger.info(
    `clear-deleted-customers-review-names-and-password-history: ${counted(
      reviewNamesCleared,
      "review names cleared",
      "embed_product_review"
    )}; ${counted(passwordHistoryDeleted, "orphaned password history rows deleted", "password_history_entry or auth_identity")}`
  )
}
