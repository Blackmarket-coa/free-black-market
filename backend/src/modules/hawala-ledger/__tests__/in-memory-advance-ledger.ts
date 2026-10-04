import HawalaLedgerModuleService from "../service"

/**
 * In-memory stand-in for the generated MedusaService CRUD the advance paths
 * use, under the REAL `HawalaLedgerModuleService` prototype (the
 * `in-memory-pool-ledger.ts` pattern, S12). `requestOrgAdvance`,
 * `approveOrgAdvance`, `recordOrgAdvanceRepayment`,
 * `calculateAdvanceEligibility` and `getVendorDashboard`'s advance read all
 * run unchanged; only persistence is shadowed.
 *
 * Three things the shadow does on purpose:
 *
 *   - `createAdvanceRepayments` enforces the partial unique index on
 *     (advance_id, external_reference) by throwing a Postgres-shaped `23505`,
 *     after yielding a tick so two concurrent calls both pass the service's
 *     pre-read and the index is what decides;
 *   - `createVendorAdvances` enforces the partial unique index
 *     UQ_hawala_vendor_advance_org_open (one open PARTNER_ORG advance per
 *     partner_org_key), after yielding a tick, the same way;
 *   - `updateVendorAdvances` honours the generated `{ selector, data }` form
 *     (the FALLBACK `approveOrgAdvance` takes when no pg connection is
 *     reachable) and returns the rows it touched — an empty list when the
 *     selector matched nothing;
 *   - with `pg: true`, `resolvePgConnection` returns a stub whose `raw`
 *     interprets the one statement the org path issues — the
 *     `UPDATE hawala_vendor_advance SET ... WHERE id = ? AND status =
 *     'PENDING_APPROVAL' AND deleted_at IS NULL RETURNING id` CAS — against
 *     the in-memory rows and records every SQL text in `sql`, so a spec can
 *     assert the CAS is what settles two concurrent approvals (the generated
 *     selector update is not atomic on a real database);
 *   - the LEDGER tables (`accounts`, `entries`) are shadowed too, so a spec can
 *     assert they stay EMPTY across every org operation: if any org path ever
 *     reached `createAccount` / `createTransfer`, the row would land here.
 *
 * Not a `*.spec.ts`, so never collected as a suite.
 */

export type Row = Record<string, unknown> & { id: string }

function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, want]) => {
    const have = row[k]
    if (Array.isArray(want)) return want.includes(have)
    if (want && typeof want === "object" && !(want instanceof Date)) {
      throw new Error(`in-memory advance ledger: unsupported filter operator on ${k}`)
    }
    return have === want
  })
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function uniqueViolation(index: string): Error & { code: string } {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${index}"`), { code: "23505" })
}

export type AdvanceLedger = {
  service: HawalaLedgerModuleService
  advances: Row[]
  repayments: Row[]
  accounts: Row[]
  entries: Row[]
  /** Every write handed to the (shadowed) generated advance persistence. */
  advanceWrites: Array<{ op: "create" | "update"; data: Record<string, unknown> }>
  /** Every filter handed to listVendorAdvances. */
  advanceReads: Array<Record<string, unknown>>
  /** Every raw SQL statement the pg stub received (empty unless `pg: true`). */
  sql: Array<{ sql: string; bindings: unknown[] }>
}

const OPEN_STATUSES = new Set(["PENDING_APPROVAL", "APPROVED", "ACTIVE"])

/**
 * The pg stub's whole vocabulary: the org-advance CAS. `SET a = ?, b = ?`
 * columns are read off the statement in order, `WHERE id = ?` takes the last
 * binding, and the `status = 'PENDING_APPROVAL'` predicate is honoured
 * literally — so a statement that drops the predicate updates every row with
 * that id, which is exactly what the concurrency spec must catch.
 */
function interpretAdvanceCas(advances: Row[], sql: string, bindings: unknown[]): { rowCount: number; rows: Row[] } {
  const normalised = sql.replace(/\s+/g, " ").trim()
  const m = /^UPDATE hawala_vendor_advance SET (.+?) WHERE (.+?)(?: RETURNING (.+))?$/i.exec(normalised)
  if (!m) throw new Error(`in-memory advance ledger: unsupported SQL ${normalised}`)
  const setCols = m[1]
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /= \?$/.test(part))
    .map((part) => part.split("=")[0].trim())
  const where = m[2]
  if (!/\bid = \?/.test(where)) throw new Error(`in-memory advance ledger: CAS must bind id; got ${where}`)
  const id = bindings[bindings.length - 1]
  const statusLiteral = /\bstatus = '([A-Z_]+)'/.exec(where)?.[1] ?? null
  const hit = advances.filter(
    (r) => r.id === id && r.deleted_at == null && (statusLiteral === null || r.status === statusLiteral)
  )
  const patch: Record<string, unknown> = {}
  setCols.forEach((col, i) => {
    patch[col] = bindings[i]
  })
  for (const row of hit) Object.assign(row, patch)
  return { rowCount: hit.length, rows: hit.map((r) => ({ id: r.id })) }
}

export function makeOrgAdvance(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    recipient_type: "PARTNER_ORG",
    vendor_id: null,
    ledger_account_id: null,
    partner_org_key: "ground_up_liberation_project",
    recipient_snapshot: {
      org_key: "ground_up_liberation_project",
      org_type: "irs_501c3",
      verification_status: "pub78_eligible",
      verified_as_of: "2026-09-10T09:18:37.000Z",
      stripe_connect_account_present: true,
      snapshot_at: "2026-10-04T12:00:00.000Z",
    },
    disbursement_reference: null,
    principal_amount: 1000,
    outstanding_balance: 1050,
    total_repaid: 0,
    fee_type: "FACTOR_RATE",
    fee_rate: 1.05,
    total_fee_charged: 0,
    repayment_method: "MANUAL",
    repayment_rate: 0,
    term_days: 30,
    start_date: new Date("2026-10-04T12:00:00Z"),
    expected_end_date: new Date("2026-11-03T12:00:00Z"),
    actual_end_date: null,
    eligibility_snapshot: { basis: "pilot MOU", approved_limit: 5000, recorded_by: "admin_1", recorded_at: "2026-10-04T12:00:00.000Z" },
    status: "PENDING_APPROVAL",
    approved_by: null,
    approved_at: null,
    metadata: null,
    ...over,
  }
}

export function makeSellerAdvance(id: string, over: Partial<Row> = {}): Row {
  return makeOrgAdvance(id, {
    recipient_type: "SELLER",
    vendor_id: "sel_1",
    ledger_account_id: "acc-earn",
    partner_org_key: null,
    recipient_snapshot: null,
    repayment_method: "AUTO_DEDUCT",
    repayment_rate: 0.2,
    status: "ACTIVE",
    ...over,
  })
}

export function makeAdvanceLedger(
  seed: { advances?: Row[]; repayments?: Row[]; accounts?: Row[]; pg?: boolean } = {}
): AdvanceLedger {
  const advances: Row[] = (seed.advances ?? []).map((r) => ({ ...r }))
  const repayments: Row[] = (seed.repayments ?? []).map((r) => ({ ...r }))
  const accounts: Row[] = (seed.accounts ?? []).map((r) => ({ ...r }))
  const entries: Row[] = []
  const advanceWrites: AdvanceLedger["advanceWrites"] = []
  const advanceReads: AdvanceLedger["advanceReads"] = []
  const sql: AdvanceLedger["sql"] = []

  const service = Object.create(HawalaLedgerModuleService.prototype) as HawalaLedgerModuleService
  const shadow = service as unknown as Record<string, unknown>

  if (seed.pg) {
    shadow.resolvePgConnection = () => ({
      raw: async (text: string, bindings: unknown[] = []) => {
        sql.push({ sql: text, bindings: [...bindings] })
        // Both concurrent callers reach the database before either row is
        // written; the statement itself is then the only arbiter.
        await tick()
        return interpretAdvanceCas(advances, text, bindings)
      },
    })
  }

  // advances — with the partial unique index on (partner_org_key) WHERE open PARTNER_ORG
  shadow.listVendorAdvances = async (filter: Record<string, unknown> = {}) => {
    advanceReads.push({ ...filter })
    return advances.filter((r) => matches(r, filter))
  }
  shadow.createVendorAdvances = async (data: Record<string, unknown>) => {
    advanceWrites.push({ op: "create", data: { ...data } })
    await tick()
    if (data.recipient_type === "PARTNER_ORG" && OPEN_STATUSES.has(String(data.status))) {
      const dup = advances.find(
        (r) =>
          r.recipient_type === "PARTNER_ORG" &&
          r.partner_org_key === data.partner_org_key &&
          OPEN_STATUSES.has(String(r.status)) &&
          r.deleted_at == null
      )
      if (dup) throw uniqueViolation("UQ_hawala_vendor_advance_org_open")
    }
    const row = { id: `adv_${advances.length + 1}`, ...data } as Row
    advances.push(row)
    return row
  }
  shadow.updateVendorAdvances = async (data: Record<string, unknown>) => {
    advanceWrites.push({ op: "update", data: { ...data } })
    if ("selector" in data && "data" in data) {
      const selector = data.selector as Record<string, unknown>
      const patch = data.data as Record<string, unknown>
      const hit = advances.filter((r) => matches(r, selector))
      for (const row of hit) Object.assign(row, patch)
      return hit
    }
    const row = advances.find((r) => r.id === data.id)
    if (!row) throw new Error(`VendorAdvance with id ${String(data.id)} not found`)
    const rest = { ...data }
    delete rest.id
    Object.assign(row, rest)
    return row
  }

  // repayments — with the partial unique index on (advance_id, external_reference)
  shadow.listAdvanceRepayments = async (filter: Record<string, unknown> = {}) => repayments.filter((r) => matches(r, filter))
  shadow.createAdvanceRepayments = async (data: Record<string, unknown>) => {
    await tick()
    if (data.external_reference != null) {
      const dup = repayments.find((r) => r.advance_id === data.advance_id && r.external_reference === data.external_reference)
      if (dup) throw uniqueViolation("UQ_hawala_advance_repayment_external_reference")
    }
    const row = { id: `rep_${repayments.length + 1}`, ...data } as Row
    repayments.push(row)
    return row
  }

  // the ledger proper — must stay empty on every org path
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
  shadow.updateBalances = async () => undefined
  shadow.evaluateMonitorsForAccounts = async () => undefined

  return { service, advances, repayments, accounts, entries, advanceWrites, advanceReads, sql }
}
