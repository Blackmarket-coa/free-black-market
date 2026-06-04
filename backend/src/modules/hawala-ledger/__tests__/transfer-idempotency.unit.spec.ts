import HawalaLedgerModuleService from "../service"

/**
 * Unit tests for createTransfer idempotency.
 *
 * The economic review (ECONOMIC_REVIEW.md, finding B4) called out
 * non-deterministic idempotency keys causing double-payouts on retry.
 * The deterministic keys are now in place; this test pins the *behavior*
 * the keys exist to guarantee: a retry with an already-used idempotency
 * key returns the existing entry and performs NO second balance mutation.
 *
 * Like update-balances-atomic.unit.spec.ts, we build a fake service
 * instance (no Medusa DI) and stub the auto-CRUD surface createTransfer
 * relies on.
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

function buildService(existingEntries: any[]) {
  const svc: any = Object.create(HawalaLedgerModuleService.prototype)

  const accountsById: Record<string, any> = {
    "acc-debit": makeAccount("acc-debit"),
    "acc-credit": makeAccount("acc-credit"),
  }

  svc.listLedgerEntries = jest.fn(async (filter: any) => {
    if (filter?.idempotency_key) {
      return existingEntries.filter(
        (e) => e.idempotency_key === filter.idempotency_key
      )
    }
    return []
  })
  svc.retrieveLedgerAccount = jest.fn(async (id: string) => accountsById[id])
  svc.createLedgerEntries = jest.fn(async (data: any) => ({ id: "entry-new", ...data }))
  svc.updateLedgerEntries = jest.fn(async (data: any) => data)
  svc.updateBalances = jest.fn(async () => undefined)

  return svc
}

describe("createTransfer idempotency (B4 regression guard)", () => {
  const transfer = {
    debit_account_id: "acc-debit",
    credit_account_id: "acc-credit",
    amount: 100,
    entry_type: "BOUNTY_PAYOUT",
    idempotency_key: "bounty-payout-bnt_1-m0",
  }

  it("returns the existing entry and does NOT mutate balances on retry", async () => {
    const existing = { id: "entry-existing", idempotency_key: transfer.idempotency_key }
    const svc = buildService([existing])

    const result = await svc.createTransfer(transfer)

    // The pre-existing entry is returned unchanged...
    expect(result).toBe(existing)
    // ...and crucially, no new entry and no balance mutation happened.
    expect(svc.createLedgerEntries).not.toHaveBeenCalled()
    expect(svc.updateBalances).not.toHaveBeenCalled()
  })

  it("creates exactly one entry and one balance pair on the first call", async () => {
    const svc = buildService([])

    await svc.createTransfer(transfer)

    expect(svc.createLedgerEntries).toHaveBeenCalledTimes(1)
    // One debit + one credit update == a single balanced transfer.
    expect(svc.updateBalances).toHaveBeenCalledTimes(2)
  })

  it("running the same transfer twice yields a single entry (simulated retry)", async () => {
    // First call: no existing entry -> creates one. We capture it and feed
    // it back as the "existing" set to simulate the retry seeing the prior write.
    const created: any[] = []
    const svc = buildService(created)
    svc.createLedgerEntries = jest.fn(async (data: any) => {
      const entry = { id: "entry-new", ...data }
      created.push(entry)
      return entry
    })

    await svc.createTransfer(transfer)
    await svc.createTransfer(transfer) // retry with same idempotency_key

    // Only the first call wrote an entry.
    expect(svc.createLedgerEntries).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(1)
  })
})
