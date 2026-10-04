import HawalaLedgerModuleService from "../service"

/**
 * In-memory stand-in for the generated MedusaService CRUD the pool paths use,
 * under the REAL `HawalaLedgerModuleService` prototype (the
 * `in-memory-partner-orgs.ts` pattern). `createTransfer`, `createInvestment`,
 * `distributeDividends`, `assignPoolCarrier`, `recordCarrierContribution`,
 * `recordCarrierDistribution`, the generated-method overrides and
 * `getVendorPoolsWithDetails` all run unchanged; only persistence is shadowed.
 *
 * Two things the shadow does on purpose:
 *
 *   - `createInvestments` / `createPoolCarrierDistributions` enforce the
 *     partial unique index on (pool_id, carrier_reference) by throwing a
 *     Postgres-shaped `23505`, after yielding a tick so two concurrent calls
 *     both pass the service's pre-read and the index is what decides.
 *   - the generated pool persistence is shadowed at `persistInvestmentPools_`
 *     (the service's single path to `super.createInvestmentPools` /
 *     `super.updateInvestmentPools`), NOT at `createInvestmentPools` /
 *     `updateInvestmentPools`, so the real overrides (which strip the carrier
 *     columns) run.
 *
 * No `__container__` registration: `resolvePgConnection` finds nothing and
 * the legacy read-modify-write paths run, which is where the mocks can see
 * what moved — and the carrier lifecycle's conditional transition falls back
 * to the generated `{ selector, data }` update, which `updateInvestments`
 * honours here (returning the rows it touched, an empty list when the
 * selector matched nothing). A `null` in any filter means SQL `IS NULL`
 * (null or absent).
 *
 * With `pg: true` (or `pg: "hold"`), `resolvePgConnection` instead returns a
 * stub whose `raw` interprets exactly ONE statement — the carrier lifecycle's
 * `UPDATE hawala_investment SET status = ?, reversed_at = ? WHERE id = ? AND
 * settlement = 'CARRIER' AND status IN (...) AND reversed_at IS NULL AND
 * deleted_at IS NULL RETURNING id` — against the in-memory rows, honouring
 * each predicate only if the statement actually carries it (so a statement
 * that drops one is caught), and records every SQL text in `sql`. Anything
 * else it is handed throws, which also proves no ledger leg is attempted.
 * `"hold"` parks every statement until the spec releases it
 * (`releaseSql(match)`), so a race can be replayed in a chosen order.
 * Not a `*.spec.ts`, so never collected as a suite.
 */

export type Row = Record<string, unknown> & { id: string }

function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, want]) => {
    const have = row[k]
    if (want === null) return have === null || have === undefined
    if (Array.isArray(want)) return want.includes(have)
    if (want && typeof want === "object" && !(want instanceof Date)) {
      throw new Error(`in-memory pool ledger: unsupported filter operator on ${k}`)
    }
    return have === want
  })
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function uniqueViolation(index: string): Error & { code: string } {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${index}"`), { code: "23505" })
}

export type PoolLedger = {
  service: HawalaLedgerModuleService
  pools: Row[]
  investments: Row[]
  distributions: Row[]
  accounts: Row[]
  entries: Row[]
  /** Every write handed to the (shadowed) generated pool persistence. */
  poolWrites: Array<{ op: "create" | "update"; data: Record<string, unknown> }>
  balanceMoves: Array<{ accountId: string; delta: number }>
  /** Every raw SQL statement the pg stub received (empty unless `pg` is set). */
  sql: Array<{ sql: string; bindings: unknown[] }>
  /** `pg: "hold"` only: statements parked until released, in arrival order. */
  heldSql: Array<{ sql: string; bindings: unknown[] }>
  /** `pg: "hold"` only: apply the first parked statement `match` accepts. */
  releaseSql: (match: (bindings: unknown[]) => boolean) => void
}

/**
 * The pg stub's whole vocabulary: the carrier lifecycle transition. The SET
 * columns are read off the statement in order; `WHERE id = ?` takes the next
 * binding and `status IN (?, ...)` the rest. Each predicate is honoured only
 * if the text carries it.
 */
function interpretCarrierTransition(investments: Row[], text: string, bindings: unknown[]): { rowCount: number; rows: Array<{ id: string }> } {
  const sql = text.replace(/\s+/g, " ").trim()
  const shape = /^UPDATE hawala_investment SET (.+?) WHERE (.+?) RETURNING id$/.exec(sql)
  if (!shape) throw new Error(`in-memory pool ledger pg stub: unexpected SQL: ${sql}`)
  const setCols = shape[1]
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.endsWith("= ?"))
    .map((c) => c.replace(/\s*=\s*\?$/, ""))
  const where = shape[2]
  const values = [...bindings]
  const patch: Record<string, unknown> = {}
  for (const col of setCols) patch[col] = values.shift()
  const id = values.shift()
  const statusIn = /status IN \(([?, ]+)\)/.exec(where)
  const from = statusIn ? values.splice(0, statusIn[1].split(",").length) : null
  const hit = investments.filter(
    (r) =>
      r.id === id &&
      (!/settlement = 'CARRIER'/.test(where) || r.settlement === "CARRIER") &&
      (from === null || from.includes(r.status)) &&
      (!/reversed_at IS NULL/.test(where) || r.reversed_at == null) &&
      (!/deleted_at IS NULL/.test(where) || r.deleted_at == null)
  )
  for (const row of hit) Object.assign(row, patch)
  return { rowCount: hit.length, rows: hit.map((r) => ({ id: r.id })) }
}

export function makeAccount(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    account_number: `ACC-${id}`,
    account_type: "USER_WALLET",
    currency_code: "USD",
    balance: 1000,
    pending_balance: 0,
    available_balance: 1000,
    owner_type: "CUSTOMER",
    owner_id: "cust_1",
    ...over,
  }
}

export function makePoolAccount(id: string, over: Partial<Row> = {}): Row {
  return makeAccount(id, { account_type: "PRODUCER_POOL", owner_type: "PRODUCER", owner_id: "prod_1", balance: 0, available_balance: 0, ...over })
}

export function makePool(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    name: `Pool ${id}`,
    producer_id: "prod_1",
    ledger_account_id: `acc-${id}`,
    target_amount: 10000,
    minimum_investment: 1,
    roi_type: "REVENUE_SHARE",
    status: "ACTIVE",
    total_raised: 0,
    total_investors: 0,
    total_distributed: 0,
    carrier_org_key: null,
    carrier_snapshot: null,
    ...over,
  }
}

export function makePoolLedger(
  seed: { pools?: Row[]; investments?: Row[]; distributions?: Row[]; accounts?: Row[]; pg?: boolean | "hold" } = {}
): PoolLedger {
  const pools: Row[] = (seed.pools ?? []).map((r) => ({ ...r }))
  const investments: Row[] = (seed.investments ?? []).map((r) => ({ ...r }))
  const distributions: Row[] = (seed.distributions ?? []).map((r) => ({ ...r }))
  const accounts: Row[] = (seed.accounts ?? []).map((r) => ({ ...r }))
  const entries: Row[] = []
  const poolWrites: PoolLedger["poolWrites"] = []
  const balanceMoves: PoolLedger["balanceMoves"] = []
  const sql: PoolLedger["sql"] = []
  const held: Array<{ sql: string; bindings: unknown[]; apply: () => void }> = []

  const service = Object.create(HawalaLedgerModuleService.prototype) as HawalaLedgerModuleService
  const shadow = service as unknown as Record<string, unknown>

  if (seed.pg) {
    const hold = seed.pg === "hold"
    shadow.resolvePgConnection = () => ({
      raw: (text: string, bindings: unknown[] = []) =>
        new Promise((resolve, reject) => {
          sql.push({ sql: text, bindings: [...bindings] })
          const apply = () => {
            try {
              resolve(interpretCarrierTransition(investments, text, bindings))
            } catch (error) {
              reject(error)
            }
          }
          // Every caller reaches the database before any statement applies;
          // the statement itself is then the only arbiter.
          if (hold) held.push({ sql: text, bindings: [...bindings], apply })
          else setTimeout(apply, 0)
        }),
    })
  }
  const releaseSql = (match: (bindings: unknown[]) => boolean) => {
    const i = held.findIndex((h) => match(h.bindings))
    if (i < 0) throw new Error("in-memory pool ledger: no parked statement matches")
    const [stmt] = held.splice(i, 1)
    stmt.apply()
  }

  // pools — through the service's single persistence path (see header)
  shadow.listInvestmentPools = async (filter: Record<string, unknown> = {}) => pools.filter((r) => matches(r, filter))
  shadow.retrieveInvestmentPool = async (id: string) => {
    const row = pools.find((r) => r.id === id)
    if (!row) throw new Error(`InvestmentPool with id ${id} not found`)
    return row
  }
  shadow.persistInvestmentPools_ = async (op: "create" | "update", data: Record<string, unknown>) => {
    poolWrites.push({ op, data: { ...data } })
    if (op === "create") {
      const row = { id: `pool_${pools.length + 1}`, carrier_org_key: null, carrier_snapshot: null, total_raised: 0, total_investors: 0, total_distributed: 0, ...data } as Row
      pools.push(row)
      return row
    }
    if ("selector" in data && "data" in data) {
      // The generated update's `{ selector, data }` form.
      const selector = data.selector as Record<string, unknown>
      const patch = data.data as Record<string, unknown>
      const hit = pools.filter((r) => matches(r, selector))
      for (const row of hit) Object.assign(row, patch)
      return hit
    }
    const row = pools.find((r) => r.id === data.id)
    if (!row) throw new Error(`InvestmentPool with id ${String(data.id)} not found`)
    const rest = { ...data }
    delete rest.id
    Object.assign(row, rest)
    return row
  }

  // investments — with the partial unique index on (pool_id, carrier_reference)
  shadow.listInvestments = async (filter: Record<string, unknown> = {}) => investments.filter((r) => matches(r, filter))
  shadow.createInvestments = async (data: Record<string, unknown>) => {
    await tick()
    if (data.carrier_reference != null) {
      const dup = investments.find((r) => r.pool_id === data.pool_id && r.carrier_reference === data.carrier_reference)
      if (dup) throw uniqueViolation("UQ_hawala_investment_pool_carrier_reference")
    }
    const row = { id: `inv_${investments.length + 1}`, settlement: "LEDGER", ...data } as Row
    investments.push(row)
    return row
  }
  shadow.updateInvestments = async (data: Record<string, unknown> & { id: string }) => {
    if ("selector" in data && "data" in data) {
      // The generated update's `{ selector, data }` form (the conditional
      // transition's no-pg fallback): the rows it touched, possibly none.
      const selector = data.selector as Record<string, unknown>
      const patch = data.data as Record<string, unknown>
      const hit = investments.filter((r) => matches(r, selector))
      for (const row of hit) Object.assign(row, patch)
      return hit
    }
    const row = investments.find((r) => r.id === data.id)
    if (!row) throw new Error(`Investment ${data.id} not found`)
    Object.assign(row, data)
    return row
  }

  // carrier distributions — same index
  shadow.listPoolCarrierDistributions = async (filter: Record<string, unknown> = {}) => distributions.filter((r) => matches(r, filter))
  shadow.createPoolCarrierDistributions = async (data: Record<string, unknown>) => {
    await tick()
    const dup = distributions.find((r) => r.pool_id === data.pool_id && r.carrier_reference === data.carrier_reference)
    if (dup) throw uniqueViolation("UQ_hawala_pool_carrier_distribution_reference")
    const row = { id: `dist_${distributions.length + 1}`, ...data } as Row
    distributions.push(row)
    return row
  }

  // accounts + entries (the ledger createTransfer writes)
  shadow.listLedgerAccounts = async (filter: Record<string, unknown> = {}) => accounts.filter((r) => matches(r, filter))
  shadow.retrieveLedgerAccount = async (id: string) => accounts.find((r) => r.id === id)
  shadow.createLedgerAccounts = async (data: Record<string, unknown>) => {
    const row = { id: `acc_${accounts.length + 1}`, ...data } as Row
    accounts.push(row)
    return row
  }
  shadow.listLedgerEntries = async (filter: Record<string, unknown> = {}) => entries.filter((r) => matches(r, filter))
  shadow.createLedgerEntries = async (data: Record<string, unknown>) => {
    const row = { id: `le_${entries.length + 1}`, ...data } as Row
    entries.push(row)
    return row
  }
  shadow.updateLedgerEntries = async (data: Record<string, unknown> & { id: string }) => {
    const row = entries.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }
  shadow.updateBalances = async (accountId: string, delta: number) => {
    balanceMoves.push({ accountId, delta })
    const acc = accounts.find((r) => r.id === accountId)
    if (acc) {
      acc.balance = Number(acc.balance) + delta
      acc.available_balance = Number(acc.available_balance) + delta
    }
  }

  // Fire-and-forget monitor sweep after a transfer; no monitors here.
  shadow.evaluateMonitorsForAccounts = async () => undefined

  return {
    service,
    pools,
    investments,
    distributions,
    accounts,
    entries,
    poolWrites,
    balanceMoves,
    sql,
    get heldSql() {
      return held.map(({ sql: text, bindings }) => ({ sql: text, bindings }))
    },
    releaseSql,
  }
}
