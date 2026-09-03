import {
  NonNativeCommissionError,
  commissionCentsForSale,
  isCommissionable,
  originForChannel,
  reportableFeeCents,
  type SaleOrigin,
} from "../commission-scope"

const native: SaleOrigin = { kind: "native", channel: "fbm" }
const faire: SaleOrigin = { kind: "external_channel", channel_id: "faire" }

describe("commission-scope: what counts as a native sale", () => {
  it("treats the fbm channel as native", () => {
    expect(originForChannel("fbm")).toEqual({ kind: "native", channel: "fbm" })
    expect(isCommissionable(originForChannel("fbm"))).toBe(true)
  })

  it("treats a missing or empty channel as native", () => {
    // The FBM line in rollUpChannelRevenue is the one built without a channel
    // id; classifying it as external would zero out FBM's own commission.
    expect(isCommissionable(originForChannel(null))).toBe(true)
    expect(isCommissionable(originForChannel(undefined))).toBe(true)
    expect(isCommissionable(originForChannel("   "))).toBe(true)
  })

  it("treats every connected marketplace as external", () => {
    for (const id of ["faire", "etsy", "amazon", "ebay", "walmart", "shopify"]) {
      expect(isCommissionable(originForChannel(id))).toBe(false)
    }
  })

  it("is case- and whitespace-insensitive", () => {
    expect(originForChannel("  FAIRE ")).toEqual({
      kind: "external_channel",
      channel_id: "faire",
    })
    expect(isCommissionable(originForChannel(" FBM "))).toBe(true)
  })
})

describe("commission-scope: commissionCentsForSale", () => {
  it("charges 3% of gross on a native sale", () => {
    expect(
      commissionCentsForSale({
        origin: native,
        grossCents: 10_000,
        platformFeePercent: 3,
      })
    ).toBe(300)
  })

  it("rounds half-up to the cent so a breakdown's parts still sum", () => {
    // 1234 * 3% = 37.02 -> 37
    expect(
      commissionCentsForSale({
        origin: native,
        grossCents: 1234,
        platformFeePercent: 3,
      })
    ).toBe(37)
    // 550 * 3% = 16.5 -> 17
    expect(
      commissionCentsForSale({
        origin: native,
        grossCents: 550,
        platformFeePercent: 3,
      })
    ).toBe(17)
  })

  it("honours a genuine seller concession below 3%", () => {
    expect(
      commissionCentsForSale({
        origin: native,
        grossCents: 10_000,
        platformFeePercent: 0,
      })
    ).toBe(0)
    expect(
      commissionCentsForSale({
        origin: native,
        grossCents: 10_000,
        platformFeePercent: 1.5,
      })
    ).toBe(150)
  })

  it("never returns a negative or fractional cent", () => {
    expect(
      commissionCentsForSale({
        origin: native,
        grossCents: -500,
        platformFeePercent: 3,
      })
    ).toBe(0)
    const value = commissionCentsForSale({
      origin: native,
      grossCents: 999,
      platformFeePercent: 3,
    })
    expect(Number.isInteger(value)).toBe(true)
  })

  it("THROWS on an external sale rather than quietly returning zero", () => {
    // A silent 0 is indistinguishable from "the rate happened to be 0%".
    // The difference matters: one is policy, the other is a caller in the
    // wrong place, and only the throw surfaces the second.
    expect(() =>
      commissionCentsForSale({
        origin: faire,
        grossCents: 10_000,
        platformFeePercent: 3,
      })
    ).toThrow(NonNativeCommissionError)
  })

  it("names the channel in the refusal, so the caller can be found", () => {
    expect(() =>
      commissionCentsForSale({
        origin: { kind: "external_channel", channel_id: "etsy" },
        grossCents: 100,
        platformFeePercent: 3,
      })
    ).toThrow(/etsy/)
  })
})

describe("commission-scope: reportableFeeCents", () => {
  it("always states FBM's own fee on a native line — never unknown", () => {
    // The regression this pins: FBM's line used to report null, so the one
    // take rate a vendor could always be told was the only one withheld.
    expect(
      reportableFeeCents({
        origin: native,
        grossCents: 20_000,
        platformFeePercent: 3,
      })
    ).toBe(600)
  })

  it("reports a native fee of 0 as 0, not as unknown", () => {
    expect(
      reportableFeeCents({
        origin: native,
        grossCents: 20_000,
        platformFeePercent: 0,
      })
    ).toBe(0)
  })

  it("passes through what an external channel reported", () => {
    expect(
      reportableFeeCents({
        origin: faire,
        grossCents: 20_000,
        platformFeePercent: 3,
        channelReportedFeeCents: 5_000,
      })
    ).toBe(5_000)
  })

  it("keeps an unreported external fee unknown rather than calling it zero", () => {
    // Treating unknown as zero would claim the channel took nothing, which is
    // the same lie in the other direction.
    expect(
      reportableFeeCents({
        origin: faire,
        grossCents: 20_000,
        platformFeePercent: 3,
        channelReportedFeeCents: null,
      })
    ).toBeNull()
    expect(
      reportableFeeCents({
        origin: faire,
        grossCents: 20_000,
        platformFeePercent: 3,
      })
    ).toBeNull()
  })

  it("never applies FBM's rate to an external line", () => {
    // The core of the rule: a Faire sale must not pick up FBM's 3% just
    // because Faire did not report its own cut.
    const fee = reportableFeeCents({
      origin: faire,
      grossCents: 100_000,
      platformFeePercent: 3,
      channelReportedFeeCents: null,
    })
    expect(fee).not.toBe(3_000)
    expect(fee).toBeNull()
  })

  it("treats a nonsense external fee as unknown, not as a negative fee", () => {
    expect(
      reportableFeeCents({
        origin: faire,
        grossCents: 1_000,
        platformFeePercent: 3,
        channelReportedFeeCents: -1,
      })
    ).toBeNull()
  })
})
