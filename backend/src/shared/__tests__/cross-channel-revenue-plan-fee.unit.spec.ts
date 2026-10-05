import { collectCrossChannelRevenue } from "../cross-channel-revenue"
import { clearPlanFeatureCache } from "../plan-entitlement-cache"
import { PAYOUT_BREAKDOWN_MODULE } from "../../modules/payout-breakdown"
import PayoutBreakdownService from "../../modules/payout-breakdown/service"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { TENANCY_MODULE } from "../../modules/tenancy"
import { CHANNEL_CONNECTOR_MODULE } from "../../modules/channel-connector/module-key"
import { FBM_CHANNEL } from "../../modules/payout-breakdown/channel-revenue"

/**
 * The vendor revenue screen's FBM line used to read the fee with
 * `PayoutBreakdownService.getEffectivePlatformFee(sellerId)`, which never
 * receives the plan rate — so every plan vendor was shown the platform
 * default. An all_access vendor (0%, Black Mask F8) would have been told FBM
 * took 3% of their sales. It now goes through `resolveSellerPlatformFeePercent`,
 * the chain the order.placed subscriber charges through.
 *
 * Real `PayoutBreakdownService` (prototype + patched reads) and the real
 * composition point; the plan module is keyed on its imported constant and the
 * container throws on anything else, and each test asserts the plan service
 * was actually reached — the catch-all fallback also yields a number.
 */

jest.mock("../seller-orders", () => ({
  getSellerOrders: jest.fn(async () => [
    { id: "order_1", created_at: "2026-10-01T00:00:00Z", seller_total_cents: 4000 },
    { id: "order_2", created_at: "2026-10-02T00:00:00Z", seller_total_cents: 6000 },
  ]),
}))

function makeContainer(opts: {
  planCode: string
  defaultPercent?: number
  overridePercent?: number | null
}) {
  const payouts = Object.create(PayoutBreakdownService.prototype) as Record<string, unknown>
  payouts.listPayoutConfigs = (async () => [
    { id: "pc_1", is_default: true, platform_fee_percent: opts.defaultPercent ?? 3 },
  ]) as never
  payouts.listSellerPayoutSettings = (async () =>
    opts.overridePercent === undefined || opts.overridePercent === null
      ? []
      : [
          {
            id: "sps_1",
            seller_id: "sel_1",
            custom_platform_fee_percent: opts.overridePercent,
          },
        ]) as never

  const ensureAssignment = jest.fn(async () => ({ plan_code: opts.planCode }))
  const plans = { ensureAssignment, getEntitledFeatureKeys: jest.fn(async () => []) }

  const resolve = jest.fn((key: string) => {
    if (key === PAYOUT_BREAKDOWN_MODULE) return payouts
    if (key === VENDOR_PLAN_MODULE) return plans
    if (key === ENTITLEMENT_MODULE) return { listActiveFeatureKeysForSeller: async () => [] }
    if (key === TENANCY_MODULE) return { resolveSellerTier: async () => "tier0_public" }
    if (key === CHANNEL_CONNECTOR_MODULE) return { listChannelOrderRecords: async () => [] }
    throw new Error(`unexpected container key: ${key}`)
  })

  return { container: { resolve } as never, ensureAssignment, resolve }
}

const fbmLine = async (c: ReturnType<typeof makeContainer>) => {
  const report = await collectCrossChannelRevenue(c.container, "sel_1", {
    since: new Date("2026-09-01T00:00:00Z"),
    currencyCode: "usd",
  })
  return report.lines.find((l) => l.channel === FBM_CHANNEL)!
}

beforeEach(() => clearPlanFeatureCache())

describe("cross-channel revenue reports the plan-resolved FBM fee", () => {
  it("shows an all_access vendor 0%, not the 3% default", async () => {
    const c = makeContainer({ planCode: "all_access" })
    const line = await fbmLine(c)

    expect(line.gross_amount).toBe(10000)
    expect(line.fee_amount).toBe(0)
    expect(line.net_amount).toBe(10000)
    expect(line.take_rate_percent).toBe(0)
    // The plan was read — this is not the degrade-to-default path.
    expect(c.ensureAssignment).toHaveBeenCalledWith("sel_1")
    expect(c.resolve).toHaveBeenCalledWith(VENDOR_PLAN_MODULE)
  })

  it("shows a free vendor exactly what it showed before: 3% in integer cents", async () => {
    const c = makeContainer({ planCode: "free" })
    const line = await fbmLine(c)

    // 3% of 4000 + 3% of 6000 = 120 + 180.
    expect(line.fee_amount).toBe(300)
    expect(Number.isInteger(line.fee_amount)).toBe(true)
    expect(line.net_amount).toBe(9700)
    expect(c.ensureAssignment).toHaveBeenCalled()
  })

  it("still lets a negotiated override beat the plan rate", async () => {
    const c = makeContainer({ planCode: "all_access", overridePercent: 1 })
    const line = await fbmLine(c)
    expect(line.fee_amount).toBe(100)
  })

  it("degrades to the platform default when the plan cannot be read", async () => {
    const c = makeContainer({ planCode: "all_access" })
    c.ensureAssignment.mockRejectedValue(new Error("plan service down"))
    const line = await fbmLine(c)
    expect(line.fee_amount).toBe(300)
  })
})
