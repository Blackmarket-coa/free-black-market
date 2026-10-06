import { FeeType } from "../models"
import PayoutBreakdownService from "../service"
import {
  DEFAULT_PROCESSING_FIXED_CENTS,
  DEFAULT_PROCESSING_PERCENT,
  computeFeeFirstSplit,
} from "../fee-first"
import { FLAG_OFF_FIXTURES, makeBreakdownService } from "./fee-first-harness"
import golden from "./fee-first-breakdown.golden.json"

/**
 * F6-2: `calculateBreakdown` takes the fee-first split ONLY when the caller
 * passes `feeFirst` (the composition point decides from FF_FEE_FIRST_SPLIT_V1;
 * this module never reads env). Real service, real config read, real fee
 * chain.
 *
 * Flag off is pinned against `fee-first-breakdown.golden.json`: the whole
 * output of the pre-F6 service (main d51aa0b9) for each fixture, captured
 * before this change and deep-compared here.
 */

const goldenOutputs = golden as unknown as Record<string, unknown>

describe("calculateBreakdown without feeFirst (flag off)", () => {
  it.each(FLAG_OFF_FIXTURES.map((f) => [f.name, f] as const))(
    "deep-equals the pre-F6 output: %s",
    async (_name, fixture) => {
      const { svc } = makeBreakdownService(fixture.opts)
      const out = await svc.calculateBreakdown(fixture.input)
      expect(out).toEqual(goldenOutputs[fixture.name])
      // Nothing fee-first leaks in: no split, no PAYMENT_PROCESSING line, no
      // per-seller processing field.
      expect("feeFirstSplit" in out).toBe(false)
      expect(out.items.some((i) => i.type === FeeType.PAYMENT_PROCESSING)).toBe(false)
      expect(out.sellerBreakdown.every((s) => !("processing" in s))).toBe(true)
    }
  )

  it("treats feeFirst: null exactly as absent", async () => {
    const { svc } = makeBreakdownService()
    const input = { subtotal: 4000, sellerId: "sel_1" }
    expect(await svc.calculateBreakdown({ ...input, feeFirst: null })).toEqual(
      await svc.calculateBreakdown(input)
    )
  })
})

describe("calculateBreakdown with feeFirst (flag on)", () => {
  it("$40 single seller: platform fee 116, seller net 3738, a PAYMENT_PROCESSING line of 146 borne by the producer", async () => {
    const { svc } = makeBreakdownService()
    const out = await svc.calculateBreakdown({ subtotal: 4000, sellerId: "sel_1", feeFirst: {} })

    expect(out.totals.platformFees).toBe(116)
    expect(out.totals.paymentProcessing).toBe(146)
    expect(out.totals.toProducers).toBe(3738)
    expect(out.sellerBreakdown[0]).toEqual({
      sellerId: "sel_1",
      sellerName: undefined,
      gross: 4000,
      fees: 146 + 116,
      net: 3738,
      processing: 146,
    })
    const processing = out.items.filter((i) => i.type === FeeType.PAYMENT_PROCESSING)
    expect(processing).toHaveLength(1)
    expect(processing[0]).toMatchObject({
      amount: 146,
      recipient: "Card processor (borne by the producer)",
    })
    expect(processing[0].description).toContain("2.9% + 30¢")
    expect(processing[0].description).toContain("before the platform fee")
    // The stored breakdown carries the same figures the split computed.
    expect(out.feeFirstSplit).toEqual(
      computeFeeFirstSplit({
        processingPercent: 2.9,
        processingFixedCents: 30,
        sellers: [{ sellerId: "sel_1", subtotalCents: 4000, chargedCents: 4000, feePercent: 3 }],
      })
    )
    // The items still account for every cent the customer paid.
    const accounted = out.items
      .filter((i) => [FeeType.PRODUCER_PRICE, FeeType.PLATFORM_FEE, FeeType.PAYMENT_PROCESSING].includes(i.type))
      .reduce((sum, i) => sum + i.amount, 0)
    expect(accounted).toBe(out.totals.customerPaid)
  })

  it("$40 on a 0% plan: platform fee 0, seller 3854, no PLATFORM_FEE line", async () => {
    const { svc } = makeBreakdownService()
    const out = await svc.calculateBreakdown({
      subtotal: 4000,
      sellerId: "sel_1",
      planFeePercentBySeller: { sel_1: 0 },
      feeFirst: {},
    })
    expect(out.totals.platformFees).toBe(0)
    expect(out.sellerBreakdown[0].net).toBe(3854)
    expect(out.items.some((i) => i.type === FeeType.PLATFORM_FEE)).toBe(false)
  })

  it("keeps the rate chain: a negotiated override still beats the plan, only the base moves", async () => {
    const { svc } = makeBreakdownService({
      settings: [{ id: "sps_1", seller_id: "sel_1", custom_platform_fee_percent: 1 }],
    })
    const out = await svc.calculateBreakdown({
      subtotal: 4000,
      sellerId: "sel_1",
      planFeePercentBySeller: { sel_1: 2 },
      feeFirst: {},
    })
    expect(out.feeFirstSplit?.sellers[0].feePercent).toBe(1)
    expect(out.totals.platformFees).toBe(Math.round(0.01 * (4000 - 146)))
  })

  it("funds the plugin and referral shares from the SMALLER fee, never the seller's net", async () => {
    const { svc } = makeBreakdownService({ pluginDeveloperPercent: 2, referralPercent: 1 })
    const out = await svc.calculateBreakdown({
      subtotal: 4000,
      sellerId: "sel_1",
      pluginsBySeller: { sel_1: [{ slug: "analytics", author_seller_id: "sel_dev" }] },
      referralBySeller: { sel_1: { referrer_seller_id: "sel_ref" } },
      feeFirst: {},
    })
    // Plugin wants 2% of 4000 = 80, capped by the fee-first fee of 116; the
    // referral share (1% = 40) is capped by what the plugin share left (36).
    expect(out.totals.platformFees).toBe(116)
    expect(out.totals.pluginDeveloperShare).toBe(80)
    expect(out.totals.referralShare).toBe(36)
    expect(out.totals.pluginDeveloperShare + out.totals.referralShare).toBeLessThanOrEqual(116)
    expect(out.sellerBreakdown[0].net).toBe(3738)
  })

  it("puts tax, delivery and tip in the single seller's leg, under processing", async () => {
    const { svc } = makeBreakdownService()
    const out = await svc.calculateBreakdown({
      subtotal: 4000,
      sellerId: "sel_1",
      tax: 320,
      deliveryFee: 500,
      tip: 200,
      feeFirst: {},
    })
    expect(out.feeFirstSplit?.chargedTotalCents).toBe(5020)
    expect(out.totals.paymentProcessing).toBe(176)
    expect(out.feeFirstSplit?.sellers[0].processingCents).toBe(176)
    expect(out.feeFirstSplit?.platformBorneProcessingCents).toBe(0)
    expect(out.totals.platformFees).toBe(Math.round(0.03 * (4000 - 176)))
  })

  it("never charges a seller the donation's processing, and leaves the DONATION line alone", async () => {
    // The donation is a direct charge on the org's own account, so it is not
    // in FBM's charge at all: the split is identical with and without it.
    const { svc } = makeBreakdownService()
    const base = { subtotal: 4000, sellerId: "sel_1", feeFirst: {} }
    const withDonation = await svc.calculateBreakdown({
      ...base,
      donation: 1500,
      donationRecipientName: "Ground Up Liberation Project",
    })
    const without = await svc.calculateBreakdown(base)
    expect(withDonation.feeFirstSplit).toEqual(without.feeFirstSplit)
    expect(withDonation.totals.paymentProcessing).toBe(146)
    expect(withDonation.items.find((i) => i.type === FeeType.DONATION)).toMatchObject({
      amount: 1500,
      recipient: "Ground Up Liberation Project",
    })
    expect(withDonation.totals.donation).toBe(1500)
    expect(withDonation.totals.customerPaid).toBe(5500)
  })

  it("multi-seller: fixed fee once, exact sum, and order-level extras in no leg are platform-borne", async () => {
    const { svc } = makeBreakdownService()
    const out = await svc.calculateBreakdown({
      subtotal: 4000,
      deliveryFee: 600,
      sellerBreakdown: [
        { sellerId: "sel_a", subtotal: 2500 },
        { sellerId: "sel_b", subtotal: 1500 },
      ],
      feeFirst: {},
    })
    const split = out.feeFirstSplit!
    expect(split.chargedTotalCents).toBe(4600)
    expect(split.processingTotalCents).toBe(Math.round(4600 * 0.029) + 30)
    expect(split.sellerBorneProcessingCents + split.platformBorneProcessingCents).toBe(
      split.processingTotalCents
    )
    expect(split.platformBorneProcessingCents).toBeGreaterThan(0)
    const lines = out.items.filter((i) => i.type === FeeType.PAYMENT_PROCESSING)
    expect(lines.map((l) => l.recipient)).toEqual([
      "Card processor (borne by the producer)",
      "Card processor (borne by the platform)",
    ])
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(split.processingTotalCents)
  })

  it("stores the processing total and the smaller fee, and reads them back", async () => {
    const { svc, stored } = makeBreakdownService()
    const out = await svc.calculateBreakdown({ subtotal: 4000, sellerId: "sel_1", feeFirst: {} })
    await svc.storeOrderBreakdown("order_1", "cus_1", out)
    expect(stored[0]).toMatchObject({
      total_platform_fees: 116,
      total_payment_processing: 146,
      total_to_producers: 3738,
      customer_paid: 4000,
    })
  })

  it("floors the displayed producer net at 0 when processing on the whole leg exceeds the subtotal", async () => {
    // 50¢ of goods, $10 delivery in the same leg: charged 1050, processing
    // round(1050 × 2.9%) + 30 = 60, commission 0. The ledger seller leg is
    // 1050 - 60 = 990; the breakdown's net is stated against the 50¢ subtotal
    // and must not go to -10.
    const { svc } = makeBreakdownService()
    const out = await svc.calculateBreakdown({
      subtotal: 50,
      sellerId: "sel_1",
      deliveryFee: 1000,
      feeFirst: {},
    })
    expect(out.feeFirstSplit?.sellers[0]).toMatchObject({ processingCents: 60, commissionCents: 0, sellerNetCents: 990 })
    expect(out.sellerBreakdown[0]).toMatchObject({ gross: 50, processing: 60, net: 0 })
    expect(out.totals.toProducers).toBe(0)
    const line = out.items.find((i) => i.type === FeeType.PAYMENT_PROCESSING)!
    expect(line.amount).toBe(60)
  })

  it("uses the processing figures the caller settled with instead of re-reading the config", async () => {
    const { svc } = makeBreakdownService({ processingPercent: 9, processingFixed: 99 })
    const out = await svc.calculateBreakdown({
      subtotal: 4000,
      sellerId: "sel_1",
      feeFirst: { processing: { percent: 2.9, fixedCents: 30 } },
    })
    expect(out.feeFirstSplit).toMatchObject({ processingPercent: 2.9, processingFixedCents: 30, processingTotalCents: 146 })
    expect(out.totals.platformFees).toBe(116)
  })
})

describe("the settlement's fallback estimate", () => {
  it("is exactly what getDefaultConfig seeds payout_config with", async () => {
    const svc = Object.create(PayoutBreakdownService.prototype) as Record<string, unknown>
    let created: Record<string, unknown> | null = null
    svc.listPayoutConfigs = (async () => []) as never
    svc.createPayoutConfigs = (async (data: Record<string, unknown>) => {
      created = data
      return data
    }) as never
    await (svc as unknown as PayoutBreakdownService).getDefaultConfig()
    expect(created).toMatchObject({
      payment_processing_percent: DEFAULT_PROCESSING_PERCENT,
      payment_processing_fixed: DEFAULT_PROCESSING_FIXED_CENTS,
    })
  })
})
