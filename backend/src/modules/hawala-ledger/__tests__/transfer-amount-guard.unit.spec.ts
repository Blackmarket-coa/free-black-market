import HawalaLedgerModuleService from "../service"

/**
 * Regression guard for the negative-amount fund-drain vector.
 *
 * `createTransfer` moves value by applying `-amount` to the debit account and
 * `+amount` to the credit account inside updateBalancesAtomic, whose only
 * safety check is the `balance + delta >= 0` compare-and-swap. A NEGATIVE
 * amount inverts both legs: the debit account is credited (+|amount|, always
 * passes the CAS) and the credit account is drained (-|amount|). A caller that
 * failed to validate its input — as the vendor payout route did, using a
 * `!amount` shorthand that treats -5000 as truthy/valid — could therefore move
 * value backwards and credit itself from a system account.
 *
 * This pins the chokepoint guard that rejects negative / non-finite amounts
 * before any balance mutation. Built as a DI-less fake service instance in the
 * same style as transfer-idempotency.unit.spec.ts.
 */

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

function buildService() {
  const svc: any = Object.create(HawalaLedgerModuleService.prototype)

  const accountsById: Record<string, any> = {
    "acc-debit": makeAccount("acc-debit"),
    "acc-credit": makeAccount("acc-credit"),
  }

  svc.listLedgerEntries = jest.fn(async () => [])
  svc.retrieveLedgerAccount = jest.fn(async (id: string) => accountsById[id])
  svc.createLedgerEntries = jest.fn(async (data: any) => ({ id: "entry-new", ...data }))
  svc.updateLedgerEntries = jest.fn(async (data: any) => data)
  svc.updateBalances = jest.fn(async () => undefined)
  svc.updateBalancesAtomic = jest.fn(async () => undefined)
  svc.resolvePgConnection = jest.fn(() => undefined)

  return svc
}

describe("createTransfer amount guard (negative-amount fund-drain regression)", () => {
  const base = {
    debit_account_id: "acc-debit",
    credit_account_id: "acc-credit",
    entry_type: "WITHDRAWAL",
    idempotency_key: "test-guard-1",
  }

  it.each([-5000, -0.01, -1])(
    "rejects negative amount %p before any balance mutation",
    async (amount) => {
      const svc = buildService()

      await expect(svc.createTransfer({ ...base, amount })).rejects.toThrow(
        /Invalid transfer amount/
      )

      // No entry written and no balance touched — the guard fires first.
      expect(svc.createLedgerEntries).not.toHaveBeenCalled()
      expect(svc.updateBalances).not.toHaveBeenCalled()
      expect(svc.updateBalancesAtomic).not.toHaveBeenCalled()
    }
  )

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite amount %p",
    async (amount) => {
      const svc = buildService()
      await expect(svc.createTransfer({ ...base, amount })).rejects.toThrow(
        /Invalid transfer amount/
      )
      expect(svc.createLedgerEntries).not.toHaveBeenCalled()
    }
  )

  it("still allows a normal positive transfer", async () => {
    const svc = buildService()
    await svc.createTransfer({ ...base, amount: 100 })
    expect(svc.createLedgerEntries).toHaveBeenCalledTimes(1)
  })

  it("allows a zero-amount (no-op) transfer — zero cannot move value", async () => {
    const svc = buildService()
    await svc.createTransfer({ ...base, amount: 0 })
    // Zero is permitted; it is harmless bookkeeping and not a drain vector.
    expect(svc.createLedgerEntries).toHaveBeenCalledTimes(1)
  })
})

describe("requestPayout amount guard", () => {
  function buildPayoutService() {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    svc.PAYOUT_TIERS = {
      WEEKLY: { name: "Weekly", fee_rate: 0, method: "ACH" },
    }
    // If the guard fails to fire, these would be reached; make them explode so
    // a regression can't silently pass.
    svc.listLedgerAccounts = jest.fn(async () => {
      throw new Error("listLedgerAccounts should not be reached for an invalid amount")
    })
    return svc
  }

  it.each([-5000, 0, NaN])(
    "rejects non-positive / non-finite payout amount %p",
    async (amount) => {
      const svc = buildPayoutService()
      await expect(
        svc.requestPayout({ vendor_id: "sel_1", amount, payout_tier: "WEEKLY" })
      ).rejects.toThrow(/positive number/)
      expect(svc.listLedgerAccounts).not.toHaveBeenCalled()
    }
  )
})
