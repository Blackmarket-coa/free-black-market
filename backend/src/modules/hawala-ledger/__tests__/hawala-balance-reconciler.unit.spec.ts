import { reconcileLedgerBalances } from "../reconciler"

/**
 * Unit tests for the pure reconcileLedgerBalances function with fakes.
 *
 * The fake pgConnection returns credit/debit sums per account; the fake
 * hawala returns accounts with cached balances. We assert that an account
 * whose cached balance diverges from (credits - debits) is reported as a
 * drift, and that matching accounts are not.
 */

function makePgConnection(
  creditRows: Array<{ account_id: string; total: number }>,
  debitRows: Array<{ account_id: string; total: number }>
) {
  return {
    raw: jest.fn(async (sql: string) => {
      if (sql.includes("credit_account_id")) {
        return { rows: creditRows }
      }
      return { rows: debitRows }
    }),
  }
}

describe("reconcileLedgerBalances", () => {
  it("detects and returns drift when cached balance diverges from ledger truth", async () => {
    const hawala = {
      listLedgerAccounts: jest.fn(async () => [
        { id: "acc-ok", balance: 50 }, // credits 100 - debits 50 = 50 -> no drift
        { id: "acc-drift", balance: 200 }, // credits 100 - debits 0 = 100 -> drift 100
      ]),
    }

    const pgConnection = makePgConnection(
      [
        { account_id: "acc-ok", total: 100 },
        { account_id: "acc-drift", total: 100 },
      ],
      [{ account_id: "acc-ok", total: 50 }]
    )

    const warn = jest.fn()
    const drifts = await reconcileLedgerBalances(hawala, pgConnection, {
      logger: { warn },
    })

    expect(drifts).toHaveLength(1)
    const d = drifts[0]
    expect(d.account_id).toBe("acc-drift")
    expect(d.cached).toBe(200)
    expect(d.computed).toBe(100)
    expect(d.drift).toBe(100)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("returns no drift when all cached balances match ledger truth (within epsilon)", async () => {
    const hawala = {
      listLedgerAccounts: jest.fn(async () => [
        { id: "acc-a", balance: 75 }, // 100 - 25 = 75
        { id: "acc-b", balance: 0 }, // no entries -> 0
      ]),
    }
    const pgConnection = makePgConnection(
      [{ account_id: "acc-a", total: 100 }],
      [{ account_id: "acc-a", total: 25 }]
    )

    const drifts = await reconcileLedgerBalances(hawala, pgConnection)
    expect(drifts).toHaveLength(0)
  })

  it("ignores sub-epsilon rounding drift", async () => {
    const hawala = {
      listLedgerAccounts: jest.fn(async () => [{ id: "acc-r", balance: 100.005 }]),
    }
    const pgConnection = makePgConnection(
      [{ account_id: "acc-r", total: 100 }],
      []
    )
    const drifts = await reconcileLedgerBalances(hawala, pgConnection)
    expect(drifts).toHaveLength(0)
  })
})
