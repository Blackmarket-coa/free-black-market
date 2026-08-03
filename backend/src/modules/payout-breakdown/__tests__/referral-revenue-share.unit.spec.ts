import { computeReferralRevenueShare } from "../referral-revenue-share"

const base = {
  availablePlatformFeeCents: 300, // e.g. 3% of a $100 order
  referralPercent: 1,
  sellerSubtotalCents: 10_000,
  referrerSellerId: "sel_referrer",
  sellerId: "sel_referred",
}

describe("computeReferralRevenueShare", () => {
  it("carves the share out of the available platform fee", () => {
    const share = computeReferralRevenueShare(base)
    // 1% of $100 = 100 cents, well under the 300 available.
    expect(share.amount_cents).toBe(100)
    expect(share.allocation).toEqual({
      referrer_seller_id: "sel_referrer",
      referred_seller_id: "sel_referred",
      amount_cents: 100,
    })
    expect(share.platform_retained_cents).toBe(200)
  })

  it("caps at the available fee so it never promises uncollected money", () => {
    // A referral percent that would exceed what the plugin share left: the
    // referrer gets the remainder, not the full computed amount.
    const share = computeReferralRevenueShare({
      ...base,
      referralPercent: 5, // wants 500 cents
      availablePlatformFeeCents: 120, // only 120 left after the plugin share
    })
    expect(share.amount_cents).toBe(120)
    expect(share.platform_retained_cents).toBe(0)
  })

  it("pays nothing when there is no earning referrer", () => {
    const share = computeReferralRevenueShare({ ...base, referrerSellerId: null })
    expect(share.amount_cents).toBe(0)
    expect(share.allocation).toBeNull()
    expect(share.platform_retained_cents).toBe(300)
  })

  it("never pays a self-referral", () => {
    const share = computeReferralRevenueShare({
      ...base,
      referrerSellerId: "sel_referred",
    })
    expect(share.amount_cents).toBe(0)
    expect(share.allocation).toBeNull()
  })

  it("pays nothing when the plugin share already consumed the whole fee", () => {
    const share = computeReferralRevenueShare({
      ...base,
      availablePlatformFeeCents: 0,
    })
    expect(share.amount_cents).toBe(0)
    expect(share.platform_retained_cents).toBe(0)
  })

  it("rejects a nonsensical percent rather than clamping it", () => {
    for (const bad of [0, -1, 101, NaN, Infinity]) {
      const share = computeReferralRevenueShare({ ...base, referralPercent: bad })
      expect(share.amount_cents).toBe(0)
      expect(share.platform_retained_cents).toBe(300)
    }
  })

  it("floors fractional inputs and never returns a negative retained amount", () => {
    const share = computeReferralRevenueShare({
      ...base,
      availablePlatformFeeCents: 100,
      referralPercent: 100,
      sellerSubtotalCents: 10_000, // wants the whole 10_000, capped to 100
    })
    expect(share.amount_cents).toBe(100)
    expect(share.platform_retained_cents).toBe(0)
  })
})
