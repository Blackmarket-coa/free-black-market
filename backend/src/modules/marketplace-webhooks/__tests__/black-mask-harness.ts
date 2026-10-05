import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import MarketplaceWebhooksService from "../service"

/**
 * In-memory MarketplaceWebhooksService for the Black Mask channel specs: the
 * REAL class (Object.create on its prototype), with the generated CRUD
 * shadowed over a row array and the module's pg connection replaced by a fake
 * that executes the ONE claim statement the channel issues against the same
 * rows.
 *
 * The fake refuses any SQL that does not carry the claim's predicates (id,
 * channel sentinel, not deleted, status pending/failed, due), so dropping a
 * predicate from the service fails the spec instead of silently passing. It
 * applies the predicate and the update in one synchronous step, which is what
 * Postgres's row lock gives the real UPDATE: of two racing claimers, exactly
 * one sees the row as claimable.
 *
 * The generated CRUD also emulates the partial unique index on `event_id`.
 */

export type DeliveryRow = {
  id: string
  subscription_id: string
  event: string
  event_id: string | null
  payload: Record<string, unknown>
  attempt: number
  status: string
  next_attempt_at: Date | null
  response_code: number | null
  response_body: string | null
  delivered_at?: Date | null
  created_at: Date
  deleted_at: Date | null
}

type Filters = Record<string, unknown>

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true
  if (Array.isArray(expected)) return expected.includes(actual)
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    const ops = expected as Record<string, unknown>
    if ("$lte" in ops) {
      return actual instanceof Date && ops.$lte instanceof Date && actual.getTime() <= ops.$lte.getTime()
    }
    if ("$ne" in ops) return actual !== ops.$ne
    throw new Error(`harness: unsupported operator ${Object.keys(ops).join(",")}`)
  }
  return actual === expected
}

function matches(row: DeliveryRow, filters: Filters): boolean {
  return Object.entries(filters).every(([k, v]) => {
    if (k === "$or") return (v as Filters[]).some((f) => matches(row, f))
    return matchValue((row as unknown as Record<string, unknown>)[k], v)
  })
}

export const CLAIM_SQL =
  /^UPDATE marketplace_webhook_delivery SET attempt = attempt \+ 1, next_attempt_at = \?, updated_at = NOW\(\) WHERE id = \? AND subscription_id = \? AND deleted_at IS NULL AND status IN \('pending', 'failed'\) AND next_attempt_at <= \? RETURNING id, attempt$/

export function makeHarness(opts: { withPg?: boolean } = {}) {
  const rows: DeliveryRow[] = []
  const sql: string[] = []
  const svc = Object.create(MarketplaceWebhooksService.prototype) as MarketplaceWebhooksService
  const mutable = svc as unknown as Record<string, unknown>

  mutable.listWebhookDeliveries = async (
    filters: Filters = {},
    config: { take?: number; order?: Record<string, "ASC" | "DESC"> } = {}
  ) => {
    let out = rows.filter((r) => !r.deleted_at && matches(r, filters))
    const [orderKey, dir] = Object.entries(config.order ?? {})[0] ?? []
    if (orderKey) {
      out = [...out].sort((a, b) => {
        const av = ((a as unknown as Record<string, unknown>)[orderKey] as Date | null)?.getTime?.() ?? 0
        const bv = ((b as unknown as Record<string, unknown>)[orderKey] as Date | null)?.getTime?.() ?? 0
        return dir === "DESC" ? bv - av : av - bv
      })
    }
    return config.take ? out.slice(0, config.take) : out
  }

  mutable.createWebhookDeliveries = async (input: Partial<DeliveryRow>) => {
    if (input.event_id && rows.some((r) => r.event_id === input.event_id && !r.deleted_at)) {
      throw new Error(
        'duplicate key value violates unique constraint "IDX_marketplace_webhook_delivery_event_id"'
      )
    }
    const row: DeliveryRow = {
      id: `whd_${rows.length + 1}`,
      subscription_id: "",
      event: "",
      event_id: null,
      payload: {},
      attempt: 0,
      status: "pending",
      next_attempt_at: null,
      response_code: null,
      response_body: null,
      created_at: new Date(Date.now() + rows.length),
      deleted_at: null,
      ...input,
    } as DeliveryRow
    rows.push(row)
    return { ...row }
  }

  mutable.updateWebhookDeliveries = async (update: Partial<DeliveryRow> & { id: string }) => {
    const r = rows.find((x) => x.id === update.id)
    if (r) Object.assign(r, update)
    return r
  }

  const pg = {
    raw: async (statement: string, bindings: unknown[] = []) => {
      const normalised = statement.replace(/\s+/g, " ").trim()
      sql.push(normalised)
      if (!CLAIM_SQL.test(normalised)) {
        throw new Error(`harness pg: unexpected SQL: ${normalised}`)
      }
      const [leaseUntil, id, channel, now] = bindings as [Date, string, string, Date]
      const row = rows.find(
        (r) =>
          r.id === id &&
          r.subscription_id === channel &&
          !r.deleted_at &&
          (r.status === "pending" || r.status === "failed") &&
          r.next_attempt_at !== null &&
          r.next_attempt_at.getTime() <= now.getTime()
      )
      if (!row) return { rows: [] }
      row.attempt += 1
      row.next_attempt_at = leaseUntil
      return { rows: [{ id: row.id, attempt: row.attempt }] }
    },
  }

  if (opts.withPg !== false) {
    mutable.__container__ = { [ContainerRegistrationKeys.PG_CONNECTION]: pg }
  }

  return { svc, rows, sql }
}
