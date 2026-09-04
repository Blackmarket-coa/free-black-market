import FundAccountingService from "../service"
import { FundRestriction } from "../models/fund"
import { FundEntryType } from "../models/fund-transaction"

/**
 * Service-level cover using the `Object.create(Service.prototype)` +
 * patched-CRUD pattern used elsewhere in the codebase. The arithmetic is
 * covered in `fund-math.unit.spec.ts`; what matters here is that the guards
 * actually refuse the writes that break a grant, and that they can be bypassed
 * deliberately rather than by accident.
 */

type FundRow = {
  id: string
  seller_id: string
  code: string
  name: string
  restriction: string
  currency_code?: string
  enforce_spend_limit?: boolean
  designated_program_id?: string | null
  spend_from?: Date | null
  spend_until?: Date | null
}

type TxRow = {
  fund_id: string
  seller_id: string
  entry_type: string
  amount_cents: number
  occurred_at?: Date | string | null
  program_id?: string | null
}

const FUND: FundRow = {
  id: "fund_1",
  seller_id: "sel_1",
  code: "LFPA-24",
  name: "Local Food Purchase Assistance",
  restriction: FundRestriction.UNRESTRICTED,
  currency_code: "usd",
  enforce_spend_limit: true,
}

const makeService = (funds: FundRow[] = [FUND], txs: TxRow[] = []) => {
  const svc = Object.create(FundAccountingService.prototype) as Record<
    string,
    unknown
  >
  const created: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []

  svc.retrieveFund = (async (id: string) => {
    const found = funds.find((f) => f.id === id)
    if (!found) throw new Error("not found")
    return found
  }) as unknown

  svc.listFunds = (async (filter: Record<string, unknown> = {}) =>
    funds.filter((f) =>
      Object.entries(filter).every(
        ([k, v]) => (f as Record<string, unknown>)[k] === v
      )
    )) as unknown

  svc.listFundTransactions = (async (filter: Record<string, unknown> = {}) =>
    txs.filter((t) =>
      Object.entries(filter).every(
        ([k, v]) => (t as Record<string, unknown>)[k] === v
      )
    )) as unknown

  svc.createFundTransactions = (async (data: Record<string, unknown>) => {
    created.push(data)
    return { id: `ft_${created.length}`, ...data }
  }) as unknown

  svc.updateFunds = (async (data: Record<string, unknown>) => {
    updated.push(data)
    return data
  }) as unknown

  return { service: svc as unknown as FundAccountingService, created, updated }
}

describe("recordEntry", () => {
  it("refuses to touch another seller's fund", async () => {
    const { service } = makeService()
    await expect(
      service.recordEntry({
        seller_id: "sel_other",
        fund_id: "fund_1",
        entry_type: FundEntryType.RECEIPT,
        amount_cents: 100,
      })
    ).rejects.toThrow(/not found/i)
  })

  it("stamps the fund's currency and defaults occurred_at", async () => {
    const { service, created } = makeService()
    await service.recordEntry({
      seller_id: "sel_1",
      fund_id: "fund_1",
      entry_type: FundEntryType.AWARD,
      amount_cents: 50_000,
    })

    expect(created[0].currency_code).toBe("usd")
    expect(created[0].occurred_at).toBeInstanceOf(Date)
  })

  it("allows a spend inside the unspent award", async () => {
    const { service, created } = makeService(undefined, [
      {
        fund_id: "fund_1",
        seller_id: "sel_1",
        entry_type: FundEntryType.AWARD,
        amount_cents: 10_000,
      },
    ])

    await service.recordEntry({
      seller_id: "sel_1",
      fund_id: "fund_1",
      entry_type: FundEntryType.EXPENDITURE,
      amount_cents: 4_000,
    })

    expect(created).toHaveLength(1)
  })

  it("refuses a spend past the unspent award", async () => {
    // Overspending restricted money is refused up front, not written and
    // flagged later — the write is the thing that costs the grant.
    const { service, created } = makeService(undefined, [
      {
        fund_id: "fund_1",
        seller_id: "sel_1",
        entry_type: FundEntryType.AWARD,
        amount_cents: 10_000,
      },
    ])

    await expect(
      service.recordEntry({
        seller_id: "sel_1",
        fund_id: "fund_1",
        entry_type: FundEntryType.EXPENDITURE,
        amount_cents: 12_000,
      })
    ).rejects.toThrow(/exceeds the fund's unspent award/i)
    expect(created).toHaveLength(0)
  })

  it("lets an explicit force bypass the spend limit", async () => {
    const { service, created } = makeService(undefined, [
      {
        fund_id: "fund_1",
        seller_id: "sel_1",
        entry_type: FundEntryType.AWARD,
        amount_cents: 10_000,
      },
    ])

    await service.recordEntry({
      seller_id: "sel_1",
      fund_id: "fund_1",
      entry_type: FundEntryType.EXPENDITURE,
      amount_cents: 12_000,
      force: true,
    })

    expect(created).toHaveLength(1)
  })

  it("does not apply the spend limit to a fund that opted out", async () => {
    const fund = { ...FUND, enforce_spend_limit: false }
    const { service, created } = makeService([fund], [])

    await service.recordEntry({
      seller_id: "sel_1",
      fund_id: "fund_1",
      entry_type: FundEntryType.EXPENDITURE,
      amount_cents: 12_000,
    })

    expect(created).toHaveLength(1)
  })

  it("refuses a spend outside a time-restricted window", async () => {
    const fund: FundRow = {
      ...FUND,
      restriction: FundRestriction.TIME,
      spend_from: new Date("2026-01-01T00:00:00Z"),
      spend_until: new Date("2026-03-31T00:00:00Z"),
    }
    const { service } = makeService([fund], [
      {
        fund_id: "fund_1",
        seller_id: "sel_1",
        entry_type: FundEntryType.AWARD,
        amount_cents: 100_000,
      },
    ])

    await expect(
      service.recordEntry({
        seller_id: "sel_1",
        fund_id: "fund_1",
        entry_type: FundEntryType.EXPENDITURE,
        amount_cents: 1_000,
        occurred_at: "2026-09-01T00:00:00Z",
      })
    ).rejects.toThrow(/spend period/i)
  })

  it("refuses to spend a permanently restricted corpus", async () => {
    const fund = { ...FUND, restriction: FundRestriction.PERMANENT }
    const { service } = makeService([fund], [])

    await expect(
      service.recordEntry({
        seller_id: "sel_1",
        fund_id: "fund_1",
        entry_type: FundEntryType.EXPENDITURE,
        amount_cents: 100,
      })
    ).rejects.toThrow(/corpus/i)
  })

  it("does not guard a reversing entry", async () => {
    // A negative expenditure gives money back; it can never overspend.
    const { service, created } = makeService(undefined, [])
    await service.recordEntry({
      seller_id: "sel_1",
      fund_id: "fund_1",
      entry_type: FundEntryType.EXPENDITURE,
      amount_cents: -1_000,
    })
    expect(created).toHaveLength(1)
  })

  it("does not guard non-expenditure entries", async () => {
    const { service, created } = makeService(undefined, [])
    await service.recordEntry({
      seller_id: "sel_1",
      fund_id: "fund_1",
      entry_type: FundEntryType.RECEIPT,
      amount_cents: 999_999,
    })
    expect(created).toHaveLength(1)
  })
})

describe("getFundReport", () => {
  it("returns balances and violations together", async () => {
    const fund: FundRow = {
      ...FUND,
      restriction: FundRestriction.PURPOSE,
      designated_program_id: "prog_meals",
    }
    const { service } = makeService([fund], [
      {
        fund_id: "fund_1",
        seller_id: "sel_1",
        entry_type: FundEntryType.AWARD,
        amount_cents: 10_000,
      },
      {
        fund_id: "fund_1",
        seller_id: "sel_1",
        entry_type: FundEntryType.EXPENDITURE,
        amount_cents: 2_000,
        program_id: "prog_admin",
      },
    ])

    const report = await service.getFundReport("sel_1", "fund_1")

    expect(report.rollup.unspent_award_cents).toBe(8_000)
    expect(report.spend_headroom_cents).toBe(8_000)
    expect(report.violations.map((v) => v.code)).toContain("off_purpose")
  })

  it("refuses another seller's fund", async () => {
    const { service } = makeService()
    await expect(service.getFundReport("sel_other", "fund_1")).rejects.toThrow(
      /not found/i
    )
  })
})

describe("getPortfolioReport", () => {
  it("reports every fund the seller holds", async () => {
    const funds: FundRow[] = [
      FUND,
      { ...FUND, id: "fund_2", code: "SNAP-25", name: "SNAP match" },
    ]
    const { service } = makeService(funds, [])
    const reports = await service.getPortfolioReport("sel_1")
    expect(reports.map((r) => r.code).sort()).toEqual(["LFPA-24", "SNAP-25"])
  })
})

describe("closeFund", () => {
  it("closes for reporting without deleting history", async () => {
    const { service, updated } = makeService()
    await service.closeFund("sel_1", "fund_1")
    expect(updated[0]).toMatchObject({ id: "fund_1", status: "closed" })
  })
})
