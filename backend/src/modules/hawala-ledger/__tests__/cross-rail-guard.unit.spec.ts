import HawalaLedgerModuleService from "../service"

/**
 * Regression guard for the cross-rail leakage vector.
 *
 * `createTransfer` derives the entry's rail from the DEBIT account only
 * (`currency_code: debitAccount.currency_code`) and, before this guard,
 * never compared the two legs' currencies. A CCR-debit → USD-credit
 * transfer would therefore pass the CCR Posture A guard and credit a USD
 * balance — closed-loop value escaping into a cash-convertible account,
 * which is precisely what Posture A exists to prevent (rails.ts:
 * `cash_convertible` is what would make the platform an MSB).
 *
 * Latent today because every production account is USD-denominated; live
 * the moment the first CCR wallet or TIME_BANK account exists (see
 * docs/CCR_HRS_IGNITION.md §4). DI-less fake service in the same style as
 * transfer-amount-guard.unit.spec.ts.
 */

function makeAccount(id: string, currency: string, balance = 1000) {
  return {
    id,
    account_number: `ACC-${id}`,
    currency_code: currency,
    balance,
    available_balance: balance,
    owner_id: "owner",
    owner_type: "SELLER",
  }
}

function buildService(accounts: Record<string, any>) {
  const svc: any = Object.create(HawalaLedgerModuleService.prototype)

  svc.listLedgerEntries = jest.fn(async () => [])
  svc.retrieveLedgerAccount = jest.fn(async (id: string) => accounts[id])
  svc.createLedgerEntries = jest.fn(async (data: any) => ({ id: "entry-new", ...data }))
  svc.updateLedgerEntries = jest.fn(async (data: any) => data)
  svc.updateBalances = jest.fn(async () => undefined)
  svc.updateBalancesAtomic = jest.fn(async () => undefined)
  svc.resolvePgConnection = jest.fn(() => undefined)

  return svc
}

describe("createTransfer cross-rail guard", () => {
  it.each([
    ["CCR", "USD"],
    ["USD", "CCR"],
    ["HRS", "USD"],
    ["USD", "HRS"],
    ["USDC", "USD"],
  ])(
    "rejects a %s-debit → %s-credit transfer before any entry or balance mutation",
    async (debitCurrency, creditCurrency) => {
      const svc = buildService({
        "acc-debit": makeAccount("acc-debit", debitCurrency),
        "acc-credit": makeAccount("acc-credit", creditCurrency),
      })

      await expect(
        svc.createTransfer({
          debit_account_id: "acc-debit",
          credit_account_id: "acc-credit",
          amount: 100,
          entry_type: "TRANSFER",
          reference_type: "ORDER",
          reference_id: "ord_1",
          idempotency_key: "cross-rail-1",
        })
      ).rejects.toThrow(/Cross-rail transfer rejected/)

      expect(svc.createLedgerEntries).not.toHaveBeenCalled()
      expect(svc.updateBalances).not.toHaveBeenCalled()
      expect(svc.updateBalancesAtomic).not.toHaveBeenCalled()
    }
  )

  it("fires before the Posture A guard — the mismatch is reported, not the missing context", async () => {
    const svc = buildService({
      "acc-debit": makeAccount("acc-debit", "CCR"),
      "acc-credit": makeAccount("acc-credit", "USD"),
    })

    // No purchase context at all: without the ordering guarantee this would
    // surface as a ClosedLoopViolationError and mask the real defect.
    await expect(
      svc.createTransfer({
        debit_account_id: "acc-debit",
        credit_account_id: "acc-credit",
        amount: 100,
        entry_type: "TRANSFER",
        idempotency_key: "cross-rail-2",
      })
    ).rejects.toThrow(/Cross-rail transfer rejected/)
  })

  it("still allows a same-rail USD transfer", async () => {
    const svc = buildService({
      "acc-debit": makeAccount("acc-debit", "USD"),
      "acc-credit": makeAccount("acc-credit", "USD"),
    })

    await svc.createTransfer({
      debit_account_id: "acc-debit",
      credit_account_id: "acc-credit",
      amount: 100,
      entry_type: "TRANSFER",
      idempotency_key: "cross-rail-3",
    })
    expect(svc.createLedgerEntries).toHaveBeenCalledTimes(1)
  })

  it("still allows a same-rail CCR transfer carrying a purchase context", async () => {
    const svc = buildService({
      "acc-debit": makeAccount("acc-debit", "CCR"),
      "acc-credit": makeAccount("acc-credit", "CCR"),
    })

    await svc.createTransfer({
      debit_account_id: "acc-debit",
      credit_account_id: "acc-credit",
      amount: 50,
      entry_type: "TRANSFER",
      reference_type: "ORDER",
      reference_id: "ord_2",
      idempotency_key: "cross-rail-4",
    })
    expect(svc.createLedgerEntries).toHaveBeenCalledTimes(1)
    expect(svc.createLedgerEntries.mock.calls[0][0].currency_code).toBe("CCR")
  })
})
