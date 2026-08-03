import {
  PROMOTION_TIERS,
  featuredFlagAction,
  getPromotionTier,
  isPromotionActive,
  promotionExpiryFrom,
} from "../promoted-listing"

const NOW = new Date("2026-08-03T00:00:00Z")
const day = 86_400_000

describe("promotion tiers", () => {
  it("has unique codes", () => {
    const codes = PROMOTION_TIERS.map((t) => t.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("gets cheaper per day as the commitment lengthens", () => {
    // Otherwise the longer tiers are strictly worse than repeating the short
    // one and there is no reason to offer them.
    const perDay = PROMOTION_TIERS.map((t) => t.price_amount / t.duration_days)
    for (let i = 1; i < perDay.length; i++) {
      expect(perDay[i]).toBeLessThan(perDay[i - 1])
    }
  })

  it("prices and dates every tier", () => {
    for (const tier of PROMOTION_TIERS) {
      expect(tier.duration_days).toBeGreaterThan(0)
      expect(tier.price_amount).toBeGreaterThan(0)
    }
  })

  it("returns null for an unknown code", () => {
    expect(getPromotionTier("forever")).toBeNull()
    expect(getPromotionTier(null)).toBeNull()
    expect(getPromotionTier(undefined)).toBeNull()
  })
})

describe("promotionExpiryFrom", () => {
  it("runs from now when there is no promotion yet", () => {
    expect(promotionExpiryFrom(7, NOW).getTime()).toBe(NOW.getTime() + 7 * day)
  })

  it("extends an unexpired promotion rather than overwriting it", () => {
    // A vendor who renews early must not lose the time they already paid for.
    const remaining = new Date(NOW.getTime() + 3 * day)
    expect(promotionExpiryFrom(7, NOW, remaining).getTime()).toBe(
      remaining.getTime() + 7 * day
    )
  })

  it("runs from now when the previous promotion already lapsed", () => {
    const lapsed = new Date(NOW.getTime() - 5 * day)
    expect(promotionExpiryFrom(7, NOW, lapsed).getTime()).toBe(
      NOW.getTime() + 7 * day
    )
  })

  it("accepts an ISO string expiry", () => {
    const remaining = new Date(NOW.getTime() + 3 * day)
    expect(
      promotionExpiryFrom(7, NOW, remaining.toISOString()).getTime()
    ).toBe(remaining.getTime() + 7 * day)
  })

  it("ignores an unparseable existing expiry", () => {
    expect(promotionExpiryFrom(7, NOW, "nonsense").getTime()).toBe(
      NOW.getTime() + 7 * day
    )
  })
})

describe("isPromotionActive", () => {
  it("is active before the expiry", () => {
    expect(isPromotionActive(new Date(NOW.getTime() + day), NOW)).toBe(true)
  })

  it("is inactive at and after the expiry", () => {
    expect(isPromotionActive(NOW, NOW)).toBe(false)
    expect(isPromotionActive(new Date(NOW.getTime() - 1), NOW)).toBe(false)
  })

  it("treats a null expiry as never ending", () => {
    // How an operator-granted, open-ended promotion is represented.
    expect(isPromotionActive(null, NOW)).toBe(true)
  })

  it("treats an unparseable expiry as expired", () => {
    // The alternative is a corrupt value buying permanent free placement.
    expect(isPromotionActive("nonsense", NOW)).toBe(false)
  })
})

describe("featuredFlagAction", () => {
  it("sets the flag for a live promotion", () => {
    expect(
      featuredFlagAction({
        currentFeatured: false,
        expiresAt: new Date(NOW.getTime() + day),
        hasPromotion: true,
        now: NOW,
      })
    ).toBe("set")
  })

  it("clears the flag once the promotion lapses", () => {
    expect(
      featuredFlagAction({
        currentFeatured: true,
        expiresAt: new Date(NOW.getTime() - day),
        hasPromotion: true,
        now: NOW,
      })
    ).toBe("clear")
  })

  it("does nothing when the flag already agrees", () => {
    // The sweep runs over every promoted seller; it must not rewrite rows that
    // already agree.
    expect(
      featuredFlagAction({
        currentFeatured: true,
        expiresAt: new Date(NOW.getTime() + day),
        hasPromotion: true,
        now: NOW,
      })
    ).toBe("none")
    expect(
      featuredFlagAction({
        currentFeatured: false,
        expiresAt: null,
        hasPromotion: false,
        now: NOW,
      })
    ).toBe("none")
  })

  it("reports a hand-set flag rather than clearing it", () => {
    // This is the case that matters. Every `featured` row today was set through
    // the admin form before promotions existed. Treating "no entitlement" as
    // "not entitled" would demote every currently-featured vendor the first
    // time the sweep ran — a silent, live change to the public directory made
    // by a background job. The sweep can only end promotions it can see.
    expect(
      featuredFlagAction({
        currentFeatured: true,
        expiresAt: null,
        hasPromotion: false,
        now: NOW,
      })
    ).toBe("unbacked")
  })

  it("keeps an open-ended operator promotion featured", () => {
    expect(
      featuredFlagAction({
        currentFeatured: true,
        expiresAt: null,
        hasPromotion: true,
        now: NOW,
      })
    ).toBe("none")
  })
})
