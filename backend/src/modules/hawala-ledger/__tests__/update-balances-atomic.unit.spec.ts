import HawalaLedgerModuleService from "../service"

/**
 * Unit tests for the private atomic balance CAS path (updateBalancesAtomic),
 * exercised via createTransfer when a fake pgConnection is supplied.
 *
 * We drive createTransfer (the public surface that uses the atomic path)
 * with a fully faked service instance so we can assert the exact SQL and
 * the insufficient-balance throw on rowCount === 0.
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
 * Build a service instance without running the real constructor (which
 * needs Medusa DI), then stub the auto-CRUD methods createTransfer relies on.
 */
function buildService(rawImpl: (sql: string, bindings: any[]) => any) {
  const svc: any = Object.create(HawalaLedgerModuleService.prototype)

  const debit = makeAccount("acc-debit")
  const credit = makeAccount("acc-credit")
  const accountsById: Record<string, any> = {
    "acc-debit": debit,
    "acc-credit": credit,
  }

  svc.listLedgerEntries = jest.fn(async () => [])
  svc.retrieveLedgerAccount = jest.fn(async (id: string) => accountsById[id])
  svc.createLedgerEntries = jest.fn(async (data: any) => ({ id: "entry-1", ...data }))
  svc.updateLedgerEntries = jest.fn(async (data: any) => data)

  const rawCalls: RawCall[] = []
  const pgConnection = {
    raw: jest.fn(async (sql: string, bindings: any[]) => {
      rawCalls.push({ sql, bindings })
      return rawImpl(sql, bindings)
    }),
  }

  return { svc, pgConnection, rawCalls }
}

describe("updateBalancesAtomic (via createTransfer)", () => {
  it("issues an atomic additive UPDATE with the delta and succeeds when rowCount=1", async () => {
    const { svc, pgConnection, rawCalls } = buildService(() => ({ rowCount: 1 }))

    const entry = await svc.createTransfer({
      debit_account_id: "acc-debit",
      credit_account_id: "acc-credit",
      amount: 100,
      entry_type: "TRANSFER",
      pgConnection,
    })

    expect(entry.id).toBe("entry-1")

    // Two balance UPDATEs: debit (-100) then credit (+100).
    expect(pgConnection.raw).toHaveBeenCalledTimes(2)

    const debitCall = rawCalls[0]
    expect(debitCall.sql).toContain("UPDATE ledger_account")
    expect(debitCall.sql).toContain("balance = balance + ?")
    expect(debitCall.sql).toContain("balance + ? >= 0")
    // delta is the first binding and is negative for the debit
    expect(debitCall.bindings[0]).toBe(-100)
    expect(debitCall.bindings).toContain("acc-debit")

    const creditCall = rawCalls[1]
    expect(creditCall.bindings[0]).toBe(100)
    expect(creditCall.bindings).toContain("acc-credit")
  })

  it("throws insufficient-balance when the atomic UPDATE affects 0 rows", async () => {
    // rowCount 0 on the first (debit) update -> insufficient balance.
    const { svc, pgConnection } = buildService(() => ({ rowCount: 0 }))

    await expect(
      svc.createTransfer({
        debit_account_id: "acc-debit",
        credit_account_id: "acc-credit",
        amount: 100,
        entry_type: "TRANSFER",
        pgConnection,
      })
    ).rejects.toThrow(/Insufficient balance in account acc-debit/)

    // Only the debit update should have run before throwing.
    expect(pgConnection.raw).toHaveBeenCalledTimes(1)
  })
})
