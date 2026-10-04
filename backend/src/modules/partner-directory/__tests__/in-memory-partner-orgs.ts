import PartnerDirectoryModuleService from "../service"

/**
 * In-memory stand-in for the generated MedusaService CRUD on `partner_org`.
 *
 * Built off the prototype (the `cottage-food-service.unit.spec.ts` pattern) so
 * the real `createOrg` / `updateOrg` / `listPublishedOrgs` / `getOrgByKey`
 * run unchanged — verification-field stripping, the publish guard, the EIN
 * normalisation — while only the persistence methods are shadowed. The
 * `MedusaService` constructor needs a container (`container.baseRepository`),
 * which is why `new` is not used.
 *
 * Column defaults mirror the model so a created row looks like a DB row. The
 * integration spec is what proves the database applies them; this helper only
 * lets the unit specs read a row the way a route would.
 *
 * Not a `*.spec.ts`: Jest's module-integration match is `**\/*.spec.[jt]s`, so
 * this file is never collected as a suite.
 */

export type OrgRow = {
  id: string
  key: string
  name: string
  org_type: string | null
  ein: string | null
  verification_status: string
  verification_source: string | null
  verified_as_of: Date | null
  verification_checked_at: Date | null
  relationship: string
  fiscal_host_key: string | null
  stripe_connect_account_id: string | null
  published: boolean
  url: string | null
  tagline: string | null
  states: unknown[]
  serves: unknown[]
  metadata: Record<string, unknown> | null
}

type Filter = Record<string, unknown>

function withDefaults(input: Record<string, unknown>, index: number): OrgRow {
  return {
    id: typeof input.id === "string" ? input.id : `porg_${index + 1}`,
    key: String(input.key),
    name: String(input.name),
    org_type: (input.org_type as string | null | undefined) ?? null,
    ein: (input.ein as string | null | undefined) ?? null,
    verification_status: (input.verification_status as string | undefined) ?? "unverified",
    verification_source: (input.verification_source as string | null | undefined) ?? null,
    verified_as_of: (input.verified_as_of as Date | null | undefined) ?? null,
    verification_checked_at: (input.verification_checked_at as Date | null | undefined) ?? null,
    relationship: (input.relationship as string | undefined) ?? "standalone",
    fiscal_host_key: (input.fiscal_host_key as string | null | undefined) ?? null,
    stripe_connect_account_id: (input.stripe_connect_account_id as string | null | undefined) ?? null,
    published: (input.published as boolean | undefined) ?? false,
    url: (input.url as string | null | undefined) ?? null,
    tagline: (input.tagline as string | null | undefined) ?? null,
    states: (input.states as unknown[] | undefined) ?? [],
    serves: (input.serves as unknown[] | undefined) ?? [],
    metadata: (input.metadata as Record<string, unknown> | null | undefined) ?? null,
  }
}

/**
 * Equality, plus the one operator the service uses (`{ $ne: value }` in
 * `listOrgsWithEin`). Anything else throws so a new operator in the service
 * cannot be matched by accident and pass by fallback.
 */
function matches(row: OrgRow, filter: Filter): boolean {
  return Object.entries(filter).every(([k, want]) => {
    const have = (row as Record<string, unknown>)[k]
    if (want && typeof want === "object" && !(want instanceof Date)) {
      const ops = Object.entries(want as Record<string, unknown>)
      return ops.every(([op, v]) => {
        if (op === "$ne") return have !== v
        throw new Error(`in-memory partner orgs: unsupported filter operator ${op}`)
      })
    }
    return have === want
  })
}

type ListConfig = { skip?: number; take?: number; order?: Record<string, "ASC" | "DESC"> }

function page(rows: OrgRow[], config: ListConfig = {}): OrgRow[] {
  let out = rows
  if (config.order) {
    const [[field, dir]] = Object.entries(config.order)
    out = [...out].sort((a, b) => {
      const x = String((a as Record<string, unknown>)[field])
      const y = String((b as Record<string, unknown>)[field])
      return dir === "DESC" ? y.localeCompare(x) : x.localeCompare(y)
    })
  }
  const skip = config.skip ?? 0
  return config.take === undefined ? out.slice(skip) : out.slice(skip, skip + config.take)
}

export type InMemoryDirectory = {
  service: PartnerDirectoryModuleService
  rows: OrgRow[]
  calls: { create: Record<string, unknown>[]; update: Record<string, unknown>[] }
}

export function makeInMemoryDirectory(seed: Array<Partial<OrgRow> & { key: string; name: string }> = []): InMemoryDirectory {
  const rows: OrgRow[] = seed.map((r, i) => withDefaults(r, i))
  const calls: InMemoryDirectory["calls"] = { create: [], update: [] }

  const service = Object.create(PartnerDirectoryModuleService.prototype) as PartnerDirectoryModuleService
  const shadow = service as unknown as Record<string, unknown>

  shadow.listPartnerOrgs = async (filter: Filter = {}, config: ListConfig = {}) =>
    page(rows.filter((r) => matches(r, filter)), config)

  shadow.retrievePartnerOrg = async (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (!row) throw new Error(`PartnerOrg with id ${id} not found`)
    return row
  }

  shadow.createPartnerOrgs = async (data: Record<string, unknown> | Record<string, unknown>[]) => {
    const list = Array.isArray(data) ? data : [data]
    const created = list.map((d) => {
      calls.create.push({ ...d })
      const row = withDefaults(d, rows.length)
      rows.push(row)
      return row
    })
    return Array.isArray(data) ? created : created[0]
  }

  shadow.updatePartnerOrgs = async (data: Record<string, unknown> & { id: string }) => {
    calls.update.push({ ...data })
    const row = rows.find((r) => r.id === data.id)
    if (!row) throw new Error(`PartnerOrg with id ${data.id} not found`)
    const rest: Record<string, unknown> = { ...data }
    delete rest.id
    Object.assign(row, rest)
    return row
  }

  return { service, rows, calls }
}
