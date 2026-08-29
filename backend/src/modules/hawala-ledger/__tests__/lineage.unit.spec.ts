import HawalaLedgerModuleService from "../service"

/**
 * Unit tests for entry lineage:
 *
 *  1. createTransfer threads correlation_id / parent_entry_id through to
 *     the persisted entry (the handles everything else hangs off).
 *  2. getOrderLineage merges direct order entries with their correlation
 *     groups, dedupes, sorts by time, and attaches back-references.
 *  3. getEntryLineage picks the right family: correlation group first,
 *     order lineage second, parent/child links last.
 */

function makeAccount(id: string) {
  return {
    id,
    account_number: `ACC-${id}`,
    currency_code: "USD",
    balance: 1000,
    available_balance: 1000,
    owner_id: "owner",
    owner_type: "SELLER",
  }
}

describe("createTransfer lineage handles", () => {
  it("persists correlation_id and parent_entry_id on the entry", async () => {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const created: any[] = []
    svc.listLedgerEntries = jest.fn(async () => [])
    svc.retrieveLedgerAccount = jest.fn(async (id: string) => makeAccount(id))
    svc.createLedgerEntries = jest.fn(async (d: any) => {
      created.push(d)
      return { id: "entry-1", ...d }
    })
    svc.updateLedgerEntries = jest.fn(async (d: any) => d)
    svc.updateBalances = jest.fn(async () => undefined)
    svc.__container__ = {
      resolve: jest.fn(() => {
        throw new Error("AwilixResolutionError: not registered")
      }),
    }

    await svc.createTransfer({
      debit_account_id: "acc-a",
      credit_account_id: "acc-b",
      amount: 10,
      entry_type: "TRANSFER",
      idempotency_key: "order-1-fee",
      correlation_id: "order-1",
      parent_entry_id: "entry-purchase",
    })

    expect(created[0].correlation_id).toBe("order-1")
    expect(created[0].parent_entry_id).toBe("entry-purchase")
  })
})

describe("getOrderLineage", () => {
  function entry(id: string, over: Record<string, unknown> = {}) {
    return {
      id,
      created_at: `2026-08-01T00:0${id.slice(-1)}:00Z`,
      correlation_id: null,
      settlement_batch_id: null,
      ...over,
    }
  }

  it("merges order entries with correlation groups, dedupes and sorts", async () => {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const direct = [
      entry("e-2", { correlation_id: "corr-1", order_id: "order-1" }),
      entry("e-1", { correlation_id: "corr-1", order_id: "order-1" }),
    ]
    // The correlation group also contains a leg that carries no order_id
    // (e.g. the payout leg keyed only by the correlation).
    const correlated = [
      ...direct,
      entry("e-3", { correlation_id: "corr-1", settlement_batch_id: "batch-9" }),
    ]
    svc.listLedgerEntries = jest.fn(async (filter: any) =>
      filter.order_id ? direct : correlated
    )
    svc.listAchTransactions = jest.fn(async () => [{ id: "ach-1" }])
    svc.listPayoutRequests = jest.fn(async () => [])
    svc.listVendorPayments = jest.fn(async () => [])

    const lineage = await svc.getOrderLineage("order-1")

    expect(lineage.entries.map((e: any) => e.id)).toEqual(["e-1", "e-2", "e-3"])
    expect(lineage.groups["corr-1"]).toEqual(["e-1", "e-2", "e-3"])
    expect(lineage.ach_transactions).toEqual([{ id: "ach-1" }])
    expect(lineage.settlement_batch_ids).toEqual(["batch-9"])
    // Back-references were queried with the merged entry ids.
    expect(svc.listAchTransactions).toHaveBeenCalledWith({
      ledger_entry_id: ["e-1", "e-2", "e-3"],
    })
  })
})

describe("getEntryLineage", () => {
  it("returns the correlation family when the entry has one", async () => {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    svc.retrieveLedgerEntry = jest.fn(async () => ({
      id: "e-1",
      correlation_id: "corr-1",
    }))
    svc.listLedgerEntries = jest.fn(async () => [
      { id: "e-2", created_at: "2026-08-01T00:02:00Z" },
      { id: "e-1", created_at: "2026-08-01T00:01:00Z" },
    ])

    const lineage = await svc.getEntryLineage("e-1")
    expect(lineage.correlation_id).toBe("corr-1")
    expect(lineage.entries.map((e: any) => e.id)).toEqual(["e-1", "e-2"])
  })

  it("falls back to parent/child links when the entry has neither correlation nor order", async () => {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const root = { id: "e-root", correlation_id: null, order_id: null, parent_entry_id: null }
    svc.retrieveLedgerEntry = jest.fn(async () => root)
    svc.listLedgerEntries = jest.fn(async () => [{ id: "e-child", parent_entry_id: "e-root" }])

    const lineage = await svc.getEntryLineage("e-root")
    expect(svc.listLedgerEntries).toHaveBeenCalledWith({ parent_entry_id: "e-root" })
    expect(lineage.entries.map((e: any) => e.id)).toEqual(["e-root", "e-child"])
  })
})
