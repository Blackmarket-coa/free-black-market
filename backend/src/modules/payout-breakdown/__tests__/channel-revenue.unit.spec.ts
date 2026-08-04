import {
  FBM_CHANNEL,
  bestNetChannel,
  rollUpChannelRevenue,
  type ChannelRevenueInput,
} from "../channel-revenue"
import { FeeType } from "../models/payout-config"

/**
 * Phase 11 exists because a vendor reading gross figures from three dashboards
 * cannot tell what they earned. These cover the ways a revenue roll-up lies:
 * by summing currencies, by treating unknown as zero, and by ranking on the
 * wrong number.
 */

const row = (
  channel: string,
  gross: number,
  fee: number | null,
  currency = "USD"
): ChannelRevenueInput => ({
  channel,
  gross_amount: gross,
  fee_amount: fee,
  currency_code: currency,
})

describe("rollUpChannelRevenue", () => {
  it("reports gross, fees and net per channel", () => {
    const r = rollUpChannelRevenue(
      [row("faire", 10_000, 2_500), row("faire", 5_000, 1_250)],
      "USD"
    )
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({
      channel: "faire",
      orders: 2,
      gross_amount: 15_000,
      fee_amount: 3_750,
      net_amount: 11_250,
      take_rate_percent: 25,
    })
  })

  it("counts an unreported fee as unknown, never as zero", () => {
    // Treating unknown as zero would silently claim the channel took nothing,
    // and a vendor would plan against money they will not receive.
    const r = rollUpChannelRevenue([row("etsy", 10_000, null)], "USD")
    expect(r.lines[0]).toMatchObject({
      gross_amount: 10_000,
      fee_amount: 0,
      unreported_fee_orders: 1,
    })
    expect(r.has_unreported_fees).toBe(true)
  })

  it("flags partial knowledge rather than hiding it in the total", () => {
    const r = rollUpChannelRevenue(
      [row("faire", 10_000, 2_500), row("faire", 10_000, null)],
      "USD"
    )
    expect(r.totals.unreported_fee_orders).toBe(1)
    expect(r.has_unreported_fees).toBe(true)
    // The net is an over-estimate, and the caller can say so because of the
    // flag rather than having to infer it.
    expect(r.totals.net_amount).toBe(17_500)
  })

  it("never sums across currencies", () => {
    // 100 USD + 100 EUR is a number that is wrong in both.
    const r = rollUpChannelRevenue(
      [row("faire", 10_000, 1_000, "USD"), row("faire", 10_000, 1_000, "EUR")],
      "USD"
    )
    expect(r.currency_code).toBe("USD")
    expect(r.totals.orders).toBe(1)
    expect(r.totals.gross_amount).toBe(10_000)
  })

  it("matches currency case-insensitively", () => {
    const r = rollUpChannelRevenue([row("faire", 100, 10, "usd")], "USD")
    expect(r.totals.orders).toBe(1)
  })

  it("includes FBM's own sales, so the comparison is against something", () => {
    const r = rollUpChannelRevenue(
      [row(FBM_CHANNEL, 20_000, null), row("faire", 10_000, 2_500)],
      "USD"
    )
    expect(r.lines.map((l) => l.channel)).toEqual([FBM_CHANNEL, "faire"])
  })

  it("sorts by gross so the channel that matters is read first", () => {
    const r = rollUpChannelRevenue(
      [row("small", 100, 10), row("big", 90_000, 100), row("mid", 5_000, 10)],
      "USD"
    )
    expect(r.lines.map((l) => l.channel)).toEqual(["big", "mid", "small"])
  })

  it("clamps a negative amount rather than inflating net revenue", () => {
    // A refund is its own record; a negative here is a mapping bug.
    const r = rollUpChannelRevenue([row("faire", -500, -100)], "USD")
    expect(r.totals.gross_amount).toBe(0)
    expect(r.totals.fee_amount).toBe(0)
  })

  it("never reports negative earnings when a fee exceeds gross", () => {
    // Showing negative net would send a vendor hunting for lost money instead
    // of for the bad row.
    const r = rollUpChannelRevenue([row("faire", 1_000, 5_000)], "USD")
    expect(r.lines[0].net_amount).toBe(0)
  })

  it("reports no take rate rather than dividing by zero", () => {
    const r = rollUpChannelRevenue([row("faire", 0, 0)], "USD")
    expect(r.lines[0].take_rate_percent).toBeNull()
    expect(r.totals.take_rate_percent).toBeNull()
  })

  it("returns an empty report rather than throwing on no sales", () => {
    const r = rollUpChannelRevenue([], "USD")
    expect(r.lines).toEqual([])
    expect(r.totals.orders).toBe(0)
    expect(r.has_unreported_fees).toBe(false)
  })
})

describe("bestNetChannel", () => {
  it("ranks on net, not gross", () => {
    // The whole point: a busy channel taking 40% can be worth less than a
    // quieter one taking 3%, and ranking on gross recommends the wrong place
    // to put effort.
    const r = rollUpChannelRevenue(
      [row("busy", 100_000, 40_000), row("quiet", 70_000, 2_100)],
      "USD"
    )
    expect(r.lines[0].channel).toBe("busy") // higher gross
    expect(bestNetChannel(r)?.channel).toBe("quiet") // higher net
  })

  it("says nothing when there is only one earning channel", () => {
    // "Your best channel is your only channel" is not a finding.
    const r = rollUpChannelRevenue([row("faire", 10_000, 1_000)], "USD")
    expect(bestNetChannel(r)).toBeNull()
  })

  it("says nothing when nothing sold", () => {
    expect(bestNetChannel(rollUpChannelRevenue([], "USD"))).toBeNull()
  })
})

describe("the channel fee is its own kind of fee", () => {
  it("is distinct from the platform fee", () => {
    // Conflating them would either double-count FBM's commission or hide the
    // marketplace's — and the vendor pays both.
    expect(FeeType.CHANNEL_FEE).toBe("CHANNEL_FEE")
    expect(FeeType.CHANNEL_FEE).not.toBe(FeeType.PLATFORM_FEE)
  })
})
