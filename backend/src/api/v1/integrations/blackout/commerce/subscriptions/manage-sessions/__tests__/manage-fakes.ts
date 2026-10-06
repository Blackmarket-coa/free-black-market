/**
 * Shared fakes for the manage-session specs (not a spec: no `.spec.` in the
 * name, so no jest mode collects it).
 *
 * Only data access is faked: the generated MarketplaceListingService CRUD for
 * `blackout_manage_session` / `creator_listing`, and the pg connection the
 * read-only customer lookup queries. The container resolves ONLY the keys it
 * is given (imported constants), and throws on anything else — a lookup under
 * a guessed key, or Modules.CUSTOMER (which would mean a customer could be
 * created), fails the spec instead of passing through a fallback.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST as mintPOST } from "../route"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../modules/marketplace-listing"
import { makeContainer } from "../../../../../../../../modules/subscription/__tests__/fake-subscription-service"

export const API_KEY = "test-commerce-api-key-1234567890"
export const FBM_BASE = "https://fbm.test"

export type Row = Record<string, unknown> & { id: string }

function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const value = row[k]
    if (Array.isArray(v)) return v.includes(value)
    if (v === null) return value === null || value === undefined
    return value === v
  })
}

/**
 * In-memory BlackoutManageSession + CreatorListing CRUD, enforcing the two
 * partial unique indexes the migration creates.
 */
export function makeListingService(listings: Row[] = []) {
  const sessions: Row[] = []
  let next = 1
  return {
    sessions,
    listCreatorListings: jest.fn(async (filter: Record<string, unknown>) =>
      listings.filter((l) => matches(l, filter))
    ),
    listBlackoutManageSessions: jest.fn(async (filter: Record<string, unknown>) =>
      sessions.filter((s) => s.deleted_at == null && matches(s, filter)).map((s) => ({ ...s }))
    ),
    createBlackoutManageSessions: jest.fn(async (data: Record<string, unknown>) => {
      const live = (s: Row) => s.deleted_at == null && s.revoked_at == null
      if (sessions.some((s) => live(s) && s.blackout_user_id === data.blackout_user_id)) {
        throw new Error('duplicate key value violates unique constraint "UQ_blackout_manage_session_live_user"')
      }
      if (sessions.some((s) => s.deleted_at == null && s.token_hash === data.token_hash)) {
        throw new Error('duplicate key value violates unique constraint "UQ_blackout_manage_session_token_hash"')
      }
      const row: Row = { id: `bms_${next++}`, deleted_at: null, ...data }
      sessions.push(row)
      return { ...row }
    }),
    updateBlackoutManageSessions: jest.fn(
      async ({ selector, data }: { selector: { id: string[] }; data: Record<string, unknown> }) =>
        sessions
          .filter((s) => selector.id.includes(s.id))
          .map((s) => {
            Object.assign(s, data)
            return { ...s }
          })
    ),
  }
}

export type FakeListingService = ReturnType<typeof makeListingService>

/** pg connection answering only the read-only customer lookup; records every statement. */
export function makePg(customers: Array<{ id: string; metadata: Record<string, unknown> }>) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = []
  return {
    statements,
    raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
      statements.push({ sql, bindings })
      if (/^\s*SELECT id FROM customer WHERE metadata->>'blackout_user_id' = \?/.test(sql)) {
        const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? Infinity)
        const rows = customers
          .filter((c) => c.metadata.blackout_user_id === bindings[0])
          .map((c) => ({ id: c.id }))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, limit)
        return { rows }
      }
      throw new Error(`fake pg: unexpected SQL ${sql}`)
    }),
  }
}

export type TestRes = {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  contentType?: string
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
  type: (t: string) => TestRes
  send: (payload: unknown) => TestRes
  setHeader: (name: string, value: string) => void
  removeHeader: (name: string) => void
}

export function makeRes(): TestRes {
  const res = { statusCode: 200, body: undefined, headers: {} } as TestRes
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  res.type = (t) => {
    res.contentType = t
    return res
  }
  res.send = (payload) => {
    res.body = payload
    return res
  }
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value
  }
  res.removeHeader = (name) => {
    delete res.headers[name.toLowerCase()]
  }
  return res
}

export function makeScope(registry: Record<string, unknown>) {
  return makeContainer(registry)
}

/** Mint through the real route; returns the response and the token from its URL. */
export async function mint(args: {
  service: FakeListingService
  pg: ReturnType<typeof makePg>
  body: Record<string, unknown>
  authorized?: boolean
}) {
  const scope = makeScope({
    [MARKETPLACE_LISTING_MODULE]: args.service,
    [ContainerRegistrationKeys.PG_CONNECTION]: args.pg,
  })
  const req = {
    headers: {
      host: "fbm.test",
      ...(args.authorized === false ? {} : { authorization: `Bearer ${API_KEY}` }),
    },
    protocol: "https",
    query: {},
    body: args.body,
    scope,
  }
  const res = makeRes()
  await mintPOST(req as never, res as never)
  const url = (res.body as { url?: string } | undefined)?.url
  const token = url ? decodeURIComponent(/manage-sessions\/([^/]+)\/page$/.exec(url)?.[1] ?? "") : null
  return { res, token, scope }
}
