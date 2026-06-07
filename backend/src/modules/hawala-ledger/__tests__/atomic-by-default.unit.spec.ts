import HawalaLedgerModuleService from "../service"

/**
 * Unit tests for the "atomic by default" money path:
 *
 *  1. createTransfer self-resolves a pg connection from the module container
 *     and uses the atomic balance CAS WITHOUT the caller threading one.
 *  2. It still falls back to the legacy read-modify-write when no connection
 *     is reachable (unit/DI-less contexts).
 *  3. Investment-pool totals (total_raised/total_investors/total_distributed)
 *     are bumped via a single atomic `col = col + ?` UPDATE when a connection
 *     is reachable, and fall back to read-modify-write otherwise.
 *
 * The service is instantiated without the real constructor (which needs
 * Medusa DI), then its auto-CRUD surface is stubbed — same approach as
 * update-balances-atomic.unit.spec.ts and transfer-idempotency.unit.spec.ts.
 */

type RawCall = { sql: string; bindings: any[] }

function makeAccount(id: string, balance = 1000) {
  return {
    id,
    account_number: `ACC-${id}`,
    currency_code: "USD",
    balance,
    available_balance: balance,
    owner_id: "owner",
    owner_type: "SELLER",
  }
}

/**
 * Build a service whose container_ resolves the given pgConnection (or, when
 * `pg` is undefined, throws on resolve like awilix does for an unregistered
 * key — exercising the guarded fallback).
 */
function buildTransferService(pg?: { raw: jest.Mock }) {
  const svc: any = Object.create(HawalaLedgerModuleService.prototype)

  const accountsById: Record<string, any> = {
    "acc-debit": makeAccount("acc-debit"),
    "acc-credit": makeAccount("acc-credit"),
  }

  svc.listLedgerEntries = jest.fn(async () => [])
  svc.retrieveLedgerAccount = jest.fn(async (id: string) => accountsById[id])
  svc.createLedgerEntries = jest.fn(async (data: any) => ({ id: "entry-1", ...data }))
  svc.updateLedgerEntries = jest.fn(async (data: any) => data)
  svc.updateBalances = jest.fn(async () => undefined)

  svc.container_ = {
    resolve: jest.fn(() => {
      if (!pg) throw new Error("AwilixResolutionError: pgConnection not registered")
      return pg
    }),
  }

  return svc
}

function makePg(): { raw: jest.Mock; calls: RawCall[] } {
  const calls: RawCall[] = []
  const raw = jest.fn(async (sql: string, bindings: any[]) => {
    calls.push({ sql, bindings })
    return { rowCount: 1 }
  })
  return { raw, calls }
}

describe("createTransfer — atomic balance update by default", () => {
  it("uses the atomic CAS via a self-resolved connection (no pgConnection arg)", async () => {
    const pg = makePg()
    const svc = buildTransferService(pg)

    await svc.createTransfer({
      debit_account_id: "acc-debit",
      credit_account_id: "acc-credit",
      amount: 100,
      entry_type: "TRANSFER",
    })

    // Two atomic balance UPDATEs ran; the legacy RMW path did not.
    expect(pg.raw).toHaveBeenCalledTimes(2)
    expect(pg.calls[0].sql).toContain("UPDATE ledger_account")
    expect(pg.calls[0].sql).toContain("balance + ? >= 0")
    expect(pg.calls[0].bindings[0]).toBe(-100)
    expect(pg.calls[1].bindings[0]).toBe(100)
    expect(svc.updateBalances).not.toHaveBeenCalled()
  })

  it("falls back to legacy updateBalances when no connection is reachable", async () => {
    const svc = buildTransferService(undefined)

    await svc.createTransfer({
      debit_account_id: "acc-debit",
      credit_account_id: "acc-credit",
      amount: 100,
      entry_type: "TRANSFER",
    })

    // Debit + credit through the read-modify-write fallback.
    expect(svc.updateBalances).toHaveBeenCalledTimes(2)
  })

  it("prefers an explicitly-passed connection over self-resolution", async () => {
    const resolved = makePg()
    const explicit = makePg()
    const svc = buildTransferService(resolved)

    await svc.createTransfer({
      debit_account_id: "acc-debit",
      credit_account_id: "acc-credit",
      amount: 50,
      entry_type: "TRANSFER",
      pgConnection: explicit.raw ? { raw: explicit.raw } : undefined,
    })

    expect(explicit.raw).toHaveBeenCalledTimes(2)
    expect(resolved.raw).not.toHaveBeenCalled()
  })
})

describe("investment-pool totals — atomic increments", () => {
  function buildPoolService(pg?: { raw: jest.Mock }) {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const pool = {
      id: "pool-1",
      ledger_account_id: "acc-pool",
      total_raised: 200,
      total_investors: 4,
      total_distributed: 30,
    }
    svc.retrieveInvestmentPool = jest.fn(async () => pool)
    svc.listInvestments = jest.fn(async () => [])
    svc.createInvestments = jest.fn(async (d: any) => ({ id: "inv-1", ...d }))
    svc.updateInvestments = jest.fn(async (d: any) => d)
    svc.updateInvestmentPools = jest.fn(async (d: any) => d)
    // Isolate the pool-total path from the balance machinery.
    svc.createTransfer = jest.fn(async () => ({ id: "entry-1" }))
    svc.container_ = {
      resolve: jest.fn(() => {
        if (!pg) throw new Error("AwilixResolutionError")
        return pg
      }),
    }
    return { svc, pool }
  }

  it("createInvestment bumps total_raised/total_investors via one atomic UPDATE", async () => {
    const pg = makePg()
    const { svc } = buildPoolService(pg)

    await svc.createInvestment({
      pool_id: "pool-1",
      investor_account_id: "acc-investor",
      amount: 75,
    })

    expect(pg.raw).toHaveBeenCalledTimes(1)
    const call = pg.calls[0]
    expect(call.sql).toContain("UPDATE hawala_investment_pool")
    expect(call.sql).toContain("total_raised = total_raised + ?")
    expect(call.sql).toContain("total_investors = total_investors + ?")
    expect(call.bindings).toEqual([75, 1, "pool-1"])
    // No read-modify-write when the atomic path ran.
    expect(svc.updateInvestmentPools).not.toHaveBeenCalled()
  })

  it("createInvestment falls back to read-modify-write without a connection", async () => {
    const { svc } = buildPoolService(undefined)

    await svc.createInvestment({
      pool_id: "pool-1",
      investor_account_id: "acc-investor",
      amount: 75,
    })

    expect(svc.updateInvestmentPools).toHaveBeenCalledWith({
      id: "pool-1",
      total_raised: 275, // 200 + 75
      total_investors: 5, // 4 + 1
    })
  })

  it("distributeDividends bumps total_distributed via an atomic UPDATE", async () => {
    const pg = makePg()
    const { svc } = buildPoolService(pg)

    await svc.distributeDividends({ pool_id: "pool-1", total_amount: 60 })

    expect(pg.raw).toHaveBeenCalledTimes(1)
    const call = pg.calls[0]
    expect(call.sql).toContain("UPDATE hawala_investment_pool")
    expect(call.sql).toContain("total_distributed = total_distributed + ?")
    expect(call.bindings).toEqual([60, "pool-1"])
    expect(svc.updateInvestmentPools).not.toHaveBeenCalled()
  })
})
