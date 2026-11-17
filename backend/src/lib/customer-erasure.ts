import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  CUSTOMER_DATA_REGISTRY,
  customerColumnOf,
  type CustomerDataEntry,
} from "./customer-data-registry"
import { createLogger } from "../shared/logger"

const log = createLogger("lib/customer-erasure")

/**
 * Apply the registry to one customer (D11-1).
 *
 * ## Why raw SQL rather than each module's service
 *
 * Forty-seven entities live in thirty-odd modules, each with its own generated
 * CRUD. Resolving a service per entity would make this file a directory of
 * special cases and would fail silently the moment a module was renamed —
 * which is the failure mode the registry exists to end. The entity name in the
 * registry is the table name Medusa creates, so one statement per entry does
 * the whole job and is auditable by reading it.
 *
 * ## Per-entity isolation
 *
 * Every statement is independently guarded. A column that turns out to be
 * `NOT NULL`, or a table a migration has renamed, must not strand the other
 * forty-six — a deletion that half-runs and reports nothing is how this became
 * a problem in the first place. Each entity's outcome is returned, so the
 * caller can tell the person what actually happened rather than "deleted:
 * true".
 *
 * ## Why `retain` rows keep their customer link
 *
 * Every statement filters on the entry's own customer column
 * (`customerColumnOf`: `customer_id`, or e.g. `backer_id` on a campaign
 * backing). The customer record itself is anonymised rather than dropped, so a
 * retained invoice still joins to a customer row with no name, email or phone
 * on it.
 * Clearing the foreign key as well would orphan the accounting record from the
 * order it belongs to and buy nothing: the identity is already gone.
 *
 * ## Entries keyed by the sign-in identity
 *
 * A table that knows the person only by how they sign in
 * (`keyedBy: "auth_identity"`: `password_history_entry`) is filtered on the
 * auth identity the deletion route revokes, passed as `authIdentityId`, not on
 * the customer id. Without one the entry is reported as failed rather than
 * skipped: the person's old password hashes would otherwise survive behind a
 * clean result.
 */

export type EntityErasureResult = {
  entity: string
  action: CustomerDataEntry["action"]
  rows: number
  error?: string
}

type PgLike = { raw: (sql: string, bindings?: unknown[]) => Promise<unknown> }

function resolvePgConnection(container: MedusaContainer): PgLike | undefined {
  try {
    const pg = (container as unknown as { resolve: (k: string) => unknown }).resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    )
    if (pg && typeof (pg as PgLike).raw === "function") return pg as PgLike
  } catch {
    // no reachable connection
  }
  return undefined
}

function rowCount(result: unknown): number {
  const r = result as { rowCount?: number; rows?: unknown[] } | undefined
  if (typeof r?.rowCount === "number") return r.rowCount
  if (Array.isArray(r?.rows)) return r.rows.length
  return 0
}

/**
 * Identifier quoting.
 *
 * Entity and field names come from the registry, which is source code rather
 * than input — but they are interpolated into SQL, so they are validated
 * anyway. A registry entry that could not be a table name is a bug worth
 * failing on rather than escaping around.
 */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to build SQL for unsafe identifier "${name}"`)
  }
  return `"${name}"`
}

export async function eraseCustomerAcrossRegistry(
  container: MedusaContainer,
  customerId: string,
  opts: {
    /** The sign-in identity being revoked: the key of `keyedBy: "auth_identity"` entries. */
    authIdentityId?: string
    /**
     * The sign-in identity outlives the profile (a vendor, a staff member or a
     * pending vendor application still signs in with it; lib/login-shared.ts),
     * so rows kept against the login, not the shopper, stay with it.
     */
    loginKept?: boolean
  } = {}
): Promise<EntityErasureResult[]> {
  const pg = resolvePgConnection(container)
  if (!pg) {
    log.warn(
      `erasure: no database connection reachable; ${CUSTOMER_DATA_REGISTRY.length} entities left untouched for ${customerId}`
    )
    return CUSTOMER_DATA_REGISTRY.map((e) => ({
      entity: e.entity,
      action: e.action,
      rows: 0,
      error: "no database connection",
    }))
  }

  const results: EntityErasureResult[] = []

  for (const entry of CUSTOMER_DATA_REGISTRY) {
    // The id this entry's rows name the person by.
    if (entry.keyedBy === "auth_identity" && opts.loginKept) {
      log.info(`erasure: ${entry.entity} kept with the login, which outlives ${customerId}'s profile`)
      results.push({ entity: entry.entity, action: entry.action, rows: 0 })
      continue
    }
    const personId = entry.keyedBy === "auth_identity" ? opts.authIdentityId : customerId
    if (!personId) {
      log.warn(`erasure: no sign-in identity given; ${entry.entity} left untouched for ${customerId}`)
      results.push({
        entity: entry.entity,
        action: entry.action,
        rows: 0,
        error: "no sign-in identity to erase by",
      })
      continue
    }
    try {
      const table = quoteIdent(entry.entity)
      const customer = quoteIdent(customerColumnOf(entry))
      let sql: string

      if (entry.action === "delete") {
        sql = `DELETE FROM ${table} WHERE ${customer} = ?`
      } else {
        const sets: string[] = []
        // An `anonymise` row loses the link to the person; a `retain` row keeps
        // it, because the customer record it points at is itself anonymised.
        if (entry.action === "anonymise") sets.push(`${customer} = NULL`)
        for (const field of entry.anonymiseFields ?? []) {
          sets.push(`${quoteIdent(field)} = NULL`)
        }
        if (sets.length === 0) {
          // A `retain` with nothing to clear: the row holds no PII of its own.
          results.push({ entity: entry.entity, action: entry.action, rows: 0 })
          continue
        }
        sql = `UPDATE ${table} SET ${sets.join(", ")} WHERE ${customer} = ?`
      }

      const result = await pg.raw(sql, [personId])
      results.push({
        entity: entry.entity,
        action: entry.action,
        rows: rowCount(result),
      })
    } catch (error) {
      const message = (error as Error)?.message ?? String(error)
      log.warn(
        `erasure: ${entry.action} failed on ${entry.entity} for ${customerId}: ${message}`
      )
      results.push({
        entity: entry.entity,
        action: entry.action,
        rows: 0,
        error: message,
      })
    }
  }

  return results
}

/**
 * Read one customer's rows from every entity the registry marks exportable.
 *
 * Same registry, so the export cannot describe less than the deletion reaches —
 * the specific way these two drifted apart.
 *
 * An entry marked `exportVia: "sql"` is read with one parameterised SELECT on
 * its table and customer column instead of `query.graph`, for a table Query
 * cannot address (the entry says why). Every row is returned, soft-deleted
 * ones included, since the erasure reaches those too.
 */
export async function readCustomerDataAcrossRegistry(
  container: MedusaContainer,
  customerId: string
): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}

  let query: { graph: (args: unknown) => Promise<{ data?: unknown[] }> }
  try {
    query = (container as unknown as { resolve: (k: string) => typeof query }).resolve(
      ContainerRegistrationKeys.QUERY
    )
  } catch {
    return out
  }

  const readBySql = async (entry: CustomerDataEntry): Promise<unknown[] | undefined> => {
    const pg = resolvePgConnection(container)
    if (!pg) throw new Error("no database connection")
    const result = (await pg.raw(
      `SELECT * FROM ${quoteIdent(entry.entity)} WHERE ${quoteIdent(customerColumnOf(entry))} = ?`,
      [customerId]
    )) as { rows?: unknown[] } | undefined
    return result?.rows
  }

  for (const entry of CUSTOMER_DATA_REGISTRY) {
    if (entry.inExport === false) continue
    try {
      const data =
        entry.exportVia === "sql"
          ? await readBySql(entry)
          : (
              await query.graph({
                entity: entry.entity,
                fields: ["*"],
                filters: { [customerColumnOf(entry)]: customerId },
              })
            ).data
      if (Array.isArray(data) && data.length > 0) {
        out[entry.entity] = data
      }
    } catch (error) {
      // An entity that cannot be read is reported in place rather than omitted,
      // so a gap in the export is visible to the person receiving it.
      out[entry.entity] = [
        { _error: `could not be read: ${(error as Error)?.message ?? error}` },
      ]
    }
  }

  return out
}
