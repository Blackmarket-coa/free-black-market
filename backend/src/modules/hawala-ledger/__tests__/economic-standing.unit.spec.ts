import HawalaLedgerModuleService from "../service"

/**
 * Unit-tests `getEconomicStandingByMxid` against in-memory fakes for the
 * pg connection (used to resolve MXID → seller_id / customer_id) and the
 * MedusaService CRUD ops (used to read ledger accounts and entries).
 */
function makeService(args: {
  sellerMetadata?: Array<{ seller_id: string; mxid: string }>
  customers?: Array<{ id: string; mxid: string }>
  ledgerAccounts?: Array<{
    id: string
    owner_id: string | null
    owner_type: string | null
    account_type: string
    available_balance: number
    pending_balance: number
    currency_code: string
  }>
  ledgerEntries?: Array<{
    id: string
    debit_account_id?: string | null
    credit_account_id?: string | null
    entry_type: string
    created_at: string
  }>
}) {
  const svc = Object.create(
    HawalaLedgerModuleService.prototype
  ) as HawalaLedgerModuleService

  ;(svc as unknown as {
    listLedgerAccounts: (filters: Record<string, unknown>) => Promise<unknown[]>
  }).listLedgerAccounts = async (filters) => {
    const accounts = args.ledgerAccounts ?? []
    if (filters.owner_id && Array.isArray(filters.owner_id)) {
      const ids = filters.owner_id as string[]
      return accounts.filter((a) => a.owner_id && ids.includes(a.owner_id))
    }
    return accounts
  }

  ;(svc as unknown as {
    listLedgerEntries: (filters: Record<string, unknown>) => Promise<unknown[]>
  }).listLedgerEntries = async (filters) => {
    const entries = args.ledgerEntries ?? []
    if (filters.credit_account_id && Array.isArray(filters.credit_account_id)) {
      const ids = filters.credit_account_id as string[]
      return entries.filter(
        (e) => e.credit_account_id && ids.includes(e.credit_account_id)
      )
    }
    return entries
  }

  const pgConnection = {
    raw: async (sql: string, bindings?: unknown[]) => {
      const mxid = (bindings?.[0] as string) ?? ""
      if (sql.includes("seller_metadata")) {
        const hit = (args.sellerMetadata ?? []).find((s) => s.mxid === mxid)
        return { rows: hit ? [{ seller_id: hit.seller_id }] : [] }
      }
      if (sql.includes("customer")) {
        const hit = (args.customers ?? []).find((c) => c.mxid === mxid)
        return { rows: hit ? [{ id: hit.id }] : [] }
      }
      return { rows: [] }
    },
  }

  return { svc, pgConnection }
}

describe("HawalaLedgerModuleService.getEconomicStandingByMxid", () => {
  const MXID = "@alice:bmc.example"

  it("returns zero totals when the MXID resolves to no accounts", async () => {
    const { svc, pgConnection } = makeService({})
    const result = await svc.getEconomicStandingByMxid({ mxid: MXID, pgConnection })
    expect(result.available).toBe(0)
    expect(result.pending).toBe(0)
    expect(result.sources).toEqual([])
    expect(result.last_settlement_at).toBeNull()
  })

  it("sums available + pending across SELLER_EARNINGS and USER_WALLET", async () => {
    const { svc, pgConnection } = makeService({
      sellerMetadata: [{ seller_id: "seller_1", mxid: MXID }],
      customers: [{ id: "cus_1", mxid: MXID }],
      ledgerAccounts: [
        {
          id: "acc_seller",
          owner_id: "seller_1",
          owner_type: "SELLER",
          account_type: "SELLER_EARNINGS",
          available_balance: 1500,
          pending_balance: 250,
          currency_code: "USD",
        },
        {
          id: "acc_wallet",
          owner_id: "cus_1",
          owner_type: "CUSTOMER",
          account_type: "USER_WALLET",
          available_balance: 50,
          pending_balance: 0,
          currency_code: "USD",
        },
      ],
    })

    const result = await svc.getEconomicStandingByMxid({ mxid: MXID, pgConnection })
    expect(result.available).toBe(1550)
    expect(result.pending).toBe(250)
    expect(result.currency).toBe("USD")
    expect(result.sources).toHaveLength(2)
    expect(result.sources.map((s) => s.account_type).sort()).toEqual([
      "SELLER_EARNINGS",
      "USER_WALLET",
    ])
  })

  it("surfaces the most recent SETTLEMENT entry as last_settlement_at", async () => {
    const { svc, pgConnection } = makeService({
      sellerMetadata: [{ seller_id: "seller_1", mxid: MXID }],
      ledgerAccounts: [
        {
          id: "acc_seller",
          owner_id: "seller_1",
          owner_type: "SELLER",
          account_type: "SELLER_EARNINGS",
          available_balance: 100,
          pending_balance: 0,
          currency_code: "USDC",
        },
      ],
      ledgerEntries: [
        {
          id: "e1",
          credit_account_id: "acc_seller",
          entry_type: "PAYOUT",
          created_at: "2026-04-30T00:00:00.000Z",
        },
        {
          id: "e2",
          credit_account_id: "acc_seller",
          entry_type: "SETTLEMENT",
          created_at: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "e3",
          credit_account_id: "acc_seller",
          entry_type: "SETTLEMENT",
          created_at: "2026-05-09T12:00:00.000Z",
        },
      ],
    })

    const result = await svc.getEconomicStandingByMxid({ mxid: MXID, pgConnection })
    expect(result.last_settlement_at).toBe("2026-05-09T12:00:00.000Z")
    expect(result.currency).toBe("USDC")
  })
})
