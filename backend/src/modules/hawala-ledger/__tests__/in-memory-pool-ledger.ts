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
 * what moved. Not a `*.spec.ts`, so never collected as a suite.
 */

export type Row = Record<string, unknown> & { id: string }

function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, want]) => {
    const have = row[k]
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

export function makePoolLedger(seed: { pools?: Row[]; investments?: Row[]; distributions?: Row[]; accounts?: Row[] } = {}): PoolLedger {
  const pools: Row[] = (seed.pools ?? []).map((r) => ({ ...r }))
  const investments: Row[] = (seed.investments ?? []).map((r) => ({ ...r }))
  const distributions: Row[] = (seed.distributions ?? []).map((r) => ({ ...r }))
  const accounts: Row[] = (seed.accounts ?? []).map((r) => ({ ...r }))
  const entries: Row[] = []
  const poolWrites: PoolLedger["poolWrites"] = []
  const balanceMoves: PoolLedger["balanceMoves"] = []

  const service = Object.create(HawalaLedgerModuleService.prototype) as HawalaLedgerModuleService
  const shadow = service as unknown as Record<string, unknown>

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

  return { service, pools, investments, distributions, accounts, entries, poolWrites, balanceMoves }
}
