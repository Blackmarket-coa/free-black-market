import FundAccountingService, { type VerifiedSettlement } from "../service"
import { FundRestriction } from "../models/fund"
import { FundEntryType } from "../models/fund-transaction"
import { SETTLEMENT_REFERENCE_TYPE } from "../fund-math"

/**
 * Service-level cover using the `Object.create(Service.prototype)` +
 * patched-CRUD pattern used elsewhere in the codebase. The arithmetic is
 * covered in `fund-math.unit.spec.ts`; what matters here is that the guards
 * actually refuse the writes that break a grant, that they can be bypassed
 * deliberately rather than by accident — and that the one guard that is
 * conservation rather than policy, the settlement citation, cannot be bypassed
 * at all.
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
  reference_type?: string | null
  reference_id?: string | null
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

const SETTLEMENT: VerifiedSettlement = {
  id: "hle_1",
  amount_cents: 20_000,
  currency_code: "USD",
  settled: true,
}

/** A verifier that knows one settlement; anything else is not found. */
const verifierFor =
  (known: Record<string, VerifiedSettlement> = { [SETTLEMENT.id]: SETTLEMENT }) =>
  async (id: string) =>
    known[id] ?? null

const cite = (id = SETTLEMENT.id) => ({
  reference_type: SETTLEMENT_REFERENCE_TYPE,
  reference_id: id,
})

const makeService = (funds: FundRow[] = [FUND], txs: TxRow[] = []) => {
  const svc = Object.create(FundAccountingService.prototype) as Record<
    string,
    unknown
  >
  const created: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []

  // Generated list filters treat an array value as IN; the stub does too, so
  // getCitedCentsBySettlement exercises the same shape it sends for real.
  const matches = (row: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, v]) =>
      Array.isArray(v) ? v.includes(row[k]) : row[k] === v
    )

  svc.retrieveFund = (async (id: string) => {
    const found = funds.find((f) => f.id === id)
    if (!found) throw new Error("not found")
    return found
  }) as unknown

  svc.listFunds = (async (filter: Record<string, unknown> = {}) =>
    funds.filter((f) => matches(f as Record<string, unknown>, filter))) as unknown

  svc.listFundTransactions = (async (filter: Record<string, unknown> = {}) =>
    // Created rows join the history so a guard reads what a prior call wrote.
    [...txs, ...(created as unknown as TxRow[])].filter((t) =>
      matches(t as Record<string, unknown>, filter)
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

const award = (fundId = "fund_1", cents = 10_000): TxRow => ({
  fund_id: fundId,
  seller_id: "sel_1",
  entry_type: FundEntryType.AWARD,
  amount_cents: cents,
})

describe("recordEntry — non-expenditure movements", () => {
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

  it("needs no settlement and never touches the verifier", async () => {
    const { service, created } = makeService()
    const verify = jest.fn(verifierFor())
    await service.recordEntry(
      {
        seller_id: "sel_1",
        fund_id: "fund_1",
        entry_type: FundEntryType.RECEIPT,
        amount_cents: 999_999,
      },
      { verifySettlement: verify }
    )
    expect(created).toHaveLength(1)
    expect(verify).not.toHaveBeenCalled()
  })
})

describe("recordEntry — an expenditure must cite a settlement", () => {
  const spend = (cents: number, extra: Record<string, unknown> = {}) => ({
    seller_id: "sel_1",
    fund_id: "fund_1",
    entry_type: FundEntryType.EXPENDITURE,
    amount_cents: cents,
    ...extra,
  })

  it("refuses a spend with no citation", async () => {
    const { service, created } = makeService(undefined, [award()])
    await expect(
      service.recordEntry(spend(1_000), { verifySettlement: verifierFor() })
    ).rejects.toThrow(/must cite the settlement/i)
    expect(created).toHaveLength(0)
  })

  it("refuses a citation of the wrong reference type", async () => {
    const { service } = makeService(undefined, [award()])
    await expect(
      service.recordEntry(
        spend(1_000, { reference_type: "order", reference_id: "hle_1" }),
        { verifySettlement: verifierFor() }
      )
    ).rejects.toThrow(/must cite the settlement/i)
  })

  it("fails closed when no verifier is available", async () => {
    // A spend that cannot be verified is not recorded — not recorded-and-flagged.
    const { service, created } = makeService(undefined, [award()])
    await expect(service.recordEntry(spend(1_000, cite()))).rejects.toThrow(
      /verification is unavailable/i
    )
    expect(created).toHaveLength(0)
  })

  it("refuses a settlement the verifier does not know", async () => {
    const { service } = makeService(undefined, [award()])
    await expect(
      service.recordEntry(spend(1_000, cite("hle_nope")), {
        verifySettlement: verifierFor(),
      })
    ).rejects.toThrow(/settlement not found/i)
  })

  it("refuses a settlement whose money has not moved yet", async () => {
    const { service } = makeService(undefined, [award()])
    const pending = { ...SETTLEMENT, id: "hle_pending", settled: false }
    await expect(
      service.recordEntry(spend(1_000, cite("hle_pending")), {
        verifySettlement: verifierFor({ hle_pending: pending }),
      })
    ).rejects.toThrow(/has not completed/i)
  })

  it("refuses a settlement in another currency", async () => {
    const { service } = makeService(undefined, [award()])
    const eur = { ...SETTLEMENT, id: "hle_eur", currency_code: "EUR" }
    await expect(
      service.recordEntry(spend(1_000, cite("hle_eur")), {
        verifySettlement: verifierFor({ hle_eur: eur }),
      })
    ).rejects.toThrow(/EUR/)
  })

  it("records a cited spend within the settlement and the award", async () => {
    const { service, created } = makeService(undefined, [award()])
    await service.recordEntry(spend(4_000, cite()), {
      verifySettlement: verifierFor(),
    })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject(cite())
  })

  it("caps attribution at what the settlement moved, across funds", async () => {
    // $200 moved. Fund A claims $120, fund B claims $60 — fine. Fund B then
    // claiming another $30 would make the two funds account for $210 of a
    // $200 payment, and is refused.
    const fundB: FundRow = { ...FUND, id: "fund_2", code: "SNAP-25" }
    const { service } = makeService(
      [FUND, fundB],
      [award("fund_1", 100_000), award("fund_2", 100_000)]
    )
    const deps = { verifySettlement: verifierFor() }

    await service.recordEntry(spend(12_000, cite()), deps)
    await service.recordEntry(spend(6_000, { ...cite(), fund_id: "fund_2" }), deps)

    await expect(
      service.recordEntry(spend(3_000, { ...cite(), fund_id: "fund_2" }), deps)
    ).rejects.toThrow(/exceeds the settlement.*18000 cents already attributed/i)
  })

  it("names the settlement cap before the award limit when both would refuse", async () => {
    // Structural before policy: "the money did not move" is the more
    // fundamental problem than "you are over your award".
    const { service } = makeService(undefined, [award("fund_1", 1_000)])
    await expect(
      service.recordEntry(spend(25_000, cite()), { verifySettlement: verifierFor() })
    ).rejects.toThrow(/exceeds the settlement/i)
  })

  it("does not let force bypass the citation or the cap", async () => {
    const { service, created } = makeService(undefined, [award()])
    const deps = { verifySettlement: verifierFor() }

    await expect(
      service.recordEntry(spend(1_000, { force: true }), deps)
    ).rejects.toThrow(/must cite the settlement/i)
    await expect(
      service.recordEntry(spend(25_000, { ...cite(), force: true }), deps)
    ).rejects.toThrow(/exceeds the settlement/i)
    expect(created).toHaveLength(0)
  })

  it("lets force bypass the award limit for a cited spend", async () => {
    const { service, created } = makeService(undefined, [award("fund_1", 1_000)])
    await service.recordEntry(spend(5_000, { ...cite(), force: true }), {
      verifySettlement: verifierFor(),
    })
    expect(created).toHaveLength(1)
  })

  it("requires a reversal to cite too, and never reverses more than was cited", async () => {
    const { service, created } = makeService(undefined, [award()])
    const deps = { verifySettlement: verifierFor() }
    await service.recordEntry(spend(4_000, cite()), deps)

    await expect(service.recordEntry(spend(-1_000), deps)).rejects.toThrow(
      /must cite the settlement/i
    )
    await expect(
      service.recordEntry(spend(-5_000, cite()), deps)
    ).rejects.toThrow(/reverses more than the 4000 cents/i)

    await service.recordEntry(spend(-4_000, cite()), deps)
    expect(created).toHaveLength(2)
    // The reversal is not held to the award limit — it gives money back.
    await expect(service.getCitedCents("sel_1", SETTLEMENT.id)).resolves.toBe(0)
  })
})

describe("recordEntry — award and period guards on a cited spend", () => {
  const deps = { verifySettlement: verifierFor() }
  const spend = (cents: number, extra: Record<string, unknown> = {}) => ({
    seller_id: "sel_1",
    fund_id: "fund_1",
    entry_type: FundEntryType.EXPENDITURE,
    amount_cents: cents,
    ...cite(),
    ...extra,
  })

  it("refuses a spend past the unspent award", async () => {
    const { service, created } = makeService(undefined, [award()])
    await expect(service.recordEntry(spend(12_000), deps)).rejects.toThrow(
      /exceeds the fund's unspent award/i
    )
    expect(created).toHaveLength(0)
  })

  it("does not apply the spend limit to a fund that opted out", async () => {
    const { service, created } = makeService([{ ...FUND, enforce_spend_limit: false }], [])
    await service.recordEntry(spend(12_000), deps)
    expect(created).toHaveLength(1)
  })

  it("refuses a spend outside a time-restricted window", async () => {
    const fund: FundRow = {
      ...FUND,
      restriction: FundRestriction.TIME,
      spend_from: new Date("2026-01-01T00:00:00Z"),
      spend_until: new Date("2026-03-31T00:00:00Z"),
    }
    const { service } = makeService([fund], [award("fund_1", 100_000)])
    await expect(
      service.recordEntry(spend(1_000, { occurred_at: "2026-09-01T00:00:00Z" }), deps)
    ).rejects.toThrow(/spend period/i)
  })

  it("refuses to spend a permanently restricted corpus", async () => {
    const { service } = makeService([{ ...FUND, restriction: FundRestriction.PERMANENT }], [])
    await expect(service.recordEntry(spend(100), deps)).rejects.toThrow(/corpus/i)
  })
})

describe("getCitedCentsBySettlement", () => {
  it("nets each settlement across funds and zero-fills the rest", async () => {
    const { service } = makeService(
      [FUND, { ...FUND, id: "fund_2", code: "B" }],
      [
        { ...award(), entry_type: FundEntryType.EXPENDITURE, amount_cents: 500, ...cite("hle_a") },
        { ...award("fund_2"), entry_type: FundEntryType.EXPENDITURE, amount_cents: 300, ...cite("hle_a") },
        { ...award("fund_2"), entry_type: FundEntryType.EXPENDITURE, amount_cents: -100, ...cite("hle_a") },
        // Same settlement id but a different seller must not leak in.
        { ...award(), seller_id: "sel_2", entry_type: FundEntryType.EXPENDITURE, amount_cents: 9_999, ...cite("hle_a") },
      ]
    )
    await expect(
      service.getCitedCentsBySettlement("sel_1", ["hle_a", "hle_b"])
    ).resolves.toEqual({ hle_a: 700, hle_b: 0 })
  })

  it("returns an empty map for no ids without querying", async () => {
    const { service } = makeService()
    await expect(service.getCitedCentsBySettlement("sel_1", [])).resolves.toEqual({})
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
      award(),
      {
        ...award(),
        entry_type: FundEntryType.EXPENDITURE,
        amount_cents: 2_000,
        program_id: "prog_admin",
        ...cite(),
      },
    ])

    const report = await service.getFundReport("sel_1", "fund_1")

    expect(report.rollup.unspent_award_cents).toBe(8_000)
    expect(report.spend_headroom_cents).toBe(8_000)
    expect(report.violations.map((v) => v.code)).toEqual(["off_purpose"])
  })

  it("surfaces a legacy spend that predates the citation rule", async () => {
    const { service } = makeService(undefined, [
      award(),
      { ...award(), entry_type: FundEntryType.EXPENDITURE, amount_cents: 2_000 },
    ])
    const report = await service.getFundReport("sel_1", "fund_1")
    expect(report.violations.map((v) => v.code)).toEqual(["uncited_spend"])
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
