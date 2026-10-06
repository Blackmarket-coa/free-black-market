import { computeNodeSplit, GrowerPayoutService, GROWER_SPLIT_CONFIG, PLATFORM_FEE } from "../grower-payout"
import { HAWALA_LEDGER_MODULE } from "../../hawala-ledger"

describe("grower-payout: computeNodeSplit", () => {
  it("splits a $100 node sale at 5% platform fee / 60% grower", () => {
    const r = computeNodeSplit(10000, 0.05, 0.6)
    expect(r.grossDollars).toBe(100)
    expect(r.platformFee).toBeCloseTo(5, 6)
    expect(r.net).toBeCloseTo(95, 6)
    expect(r.growerAmount).toBeCloseTo(57, 6)
    expect(r.hubAmount).toBe(38) // 95 - 57, rounded to cents
  })

  it("gives the hub nothing when the grower keeps 100% (hub_sc)", () => {
    const r = computeNodeSplit(10000, 0.05, 1.0)
    expect(r.hubAmount).toBe(0)
    expect(r.growerAmount).toBeCloseTo(95, 6)
  })

  it("rounds the hub amount to whole cents", () => {
    const r = computeNodeSplit(3333, 0.05, 0.62)
    // gross 33.33, fee 1.6665, net 31.6635, grower 19.63137, hub 12.03213 -> 12.03
    expect(r.hubAmount).toBe(12.03)
  })

  it("handles a zero-value line", () => {
    const r = computeNodeSplit(0, 0.05, 0.6)
    expect(r.grossDollars).toBe(0)
    expect(r.hubAmount).toBe(0)
  })

  it("keeps split config + platform fee constants in expected ranges", () => {
    expect(GROWER_SPLIT_CONFIG.hub_sc).toBe(1.0)
    expect(GROWER_SPLIT_CONFIG.node_nc_mtn).toBe(0.62)
    for (const v of Object.values(GROWER_SPLIT_CONFIG)) {
      expect(v).toBeGreaterThanOrEqual(0.6)
      expect(v).toBeLessThanOrEqual(1.0)
    }
    expect(PLATFORM_FEE).toBe(0.05)
  })
})

describe("grower-payout: processMonthlyPayouts and card processing owed", () => {
  const period = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") }
  const world = (options: { payable_balance: number; card_processing_owed: number }) => {
    const requestPayout = jest.fn(async () => ({ id: "pr_1" }))
    const hawala = {
      getOrCreateSellerEarnings: async () => ({ id: "acc-earnings" }),
      listLedgerEntries: async (f: Record<string, unknown>) =>
        f.credit_account_id
          ? [{ id: "le_1", entry_type: "TRANSFER", amount: 20, created_at: "2026-09-10T00:00:00Z" }]
          : [],
      getPayoutOptions: async () => options,
      requestPayout,
    }
    const container = {
      resolve: (key: string) => {
        if (key === HAWALA_LEDGER_MODULE) return hawala
        throw new Error(`unexpected container key: ${key}`)
      },
    }
    return { svc: new GrowerPayoutService(container as never), requestPayout }
  }

  it("asks for the month's net less what is owed, not the gross net the backstop would refuse", async () => {
    const w = world({ payable_balance: 18.54, card_processing_owed: 1.46 })
    const [r] = await w.svc.processMonthlyPayouts(["sel_1"], period)
    expect(w.requestPayout).toHaveBeenCalledWith({ vendor_id: "sel_1", amount: 18.54, payout_tier: "WEEKLY" })
    expect(r).toMatchObject({ status: "requested", amount: 18.54 })
  })

  it("nothing owed: the month's net, exactly as before", async () => {
    const w = world({ payable_balance: 20, card_processing_owed: 0 })
    await w.svc.processMonthlyPayouts(["sel_1"], period)
    expect(w.requestPayout).toHaveBeenCalledWith({ vendor_id: "sel_1", amount: 20, payout_tier: "WEEKLY" })
  })

  it("owing at least the whole balance: deferred with a plain reason, no payout requested", async () => {
    const w = world({ payable_balance: 0, card_processing_owed: 25 })
    const [r] = await w.svc.processMonthlyPayouts(["sel_1"], period)
    expect(w.requestPayout).not.toHaveBeenCalled()
    expect(r).toMatchObject({ status: "deferred", amount: 0 })
  })
})
