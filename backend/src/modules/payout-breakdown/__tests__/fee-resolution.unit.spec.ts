import {
  resolvePlatformFee,
  ZERO_FEE_TRANSACTION_KINDS,
  type PlatformFeeTransactionKind,
} from "../fee-resolution"

const NOW = new Date("2026-08-02T12:00:00Z")
const FUTURE = new Date("2026-12-01T00:00:00Z")
const PAST = new Date("2026-01-01T00:00:00Z")

describe("resolvePlatformFee precedence", () => {
  it("uses the platform default when there is nothing else", () => {
    const r = resolvePlatformFee({ platformDefault: 3, now: NOW })
    expect(r).toEqual({
      percent: 3,
      source: "platform_default",
      override_expired: false,
      override_reason: null,
    })
  })

  it("prefers the plan's rate over the platform default", () => {
    const r = resolvePlatformFee({ planPercent: 5, platformDefault: 3, now: NOW })
    expect(r.percent).toBe(5)
    expect(r.source).toBe("plan")
  })

  it("prefers a negotiated override over the plan", () => {
    // Otherwise moving a seller onto a plan would silently revoke a rate a
    // human agreed to.
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: 1.5, fee_reduction_reason: "founding vendor" },
      planPercent: 5,
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(1.5)
    expect(r.source).toBe("seller_override")
    expect(r.override_reason).toBe("founding vendor")
  })

  it("treats a zero override as a real concession, not as absent", () => {
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: 0 },
      planPercent: 5,
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(0)
    expect(r.source).toBe("seller_override")
  })

  it("honours an override with a future expiry", () => {
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: 1, fee_reduction_expires_at: FUTURE },
      planPercent: 5,
      platformDefault: 3,
      now: NOW,
    })
    expect(r.source).toBe("seller_override")
  })

  it("falls through to the plan once the override expires", () => {
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: 1, fee_reduction_expires_at: PAST },
      planPercent: 5,
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(5)
    expect(r.source).toBe("plan")
    // Reported so an admin screen can say "expired" rather than show nothing.
    expect(r.override_expired).toBe(true)
  })

  it("falls all the way through when an expired override has no plan under it", () => {
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: 1, fee_reduction_expires_at: PAST },
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(3)
    expect(r.source).toBe("platform_default")
    expect(r.override_expired).toBe(true)
  })

  it("accepts an ISO string expiry", () => {
    const r = resolvePlatformFee({
      override: {
        custom_platform_fee_percent: 1,
        fee_reduction_expires_at: PAST.toISOString(),
      },
      platformDefault: 3,
      now: NOW,
    })
    expect(r.source).toBe("platform_default")
  })

  it("treats an unparseable expiry as expired", () => {
    // Treating it as "never expires" would let a corrupt value grant a
    // permanent discount.
    const r = resolvePlatformFee({
      override: {
        custom_platform_fee_percent: 1,
        fee_reduction_expires_at: "not-a-date",
      },
      platformDefault: 3,
      now: NOW,
    })
    expect(r.source).toBe("platform_default")
    expect(r.override_expired).toBe(true)
  })

  it("handles a missing settings row", () => {
    const r = resolvePlatformFee({ override: null, platformDefault: 3, now: NOW })
    expect(r.percent).toBe(3)
  })
})

describe("resolvePlatformFee rejects unusable rates", () => {
  it("ignores a negative override", () => {
    // A negative fee pays the seller MORE than the customer paid.
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: -5 },
      planPercent: 4,
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(4)
    expect(r.source).toBe("plan")
  })

  it("ignores an over-100 override", () => {
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: 150 },
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(3)
  })

  it("ignores a non-numeric override", () => {
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: "2" as unknown as number },
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(3)
  })

  it("ignores NaN anywhere in the chain", () => {
    const r = resolvePlatformFee({
      override: { custom_platform_fee_percent: Number.NaN },
      planPercent: Number.NaN,
      platformDefault: 3,
      now: NOW,
    })
    expect(r.percent).toBe(3)
    expect(r.source).toBe("platform_default")
  })

  it("ignores a negative plan rate", () => {
    const r = resolvePlatformFee({ planPercent: -1, platformDefault: 3, now: NOW })
    expect(r.percent).toBe(3)
    expect(r.source).toBe("platform_default")
  })

  it("bottoms out at 0 when even the platform default is corrupt", () => {
    // Nothing left to fall through to. Undercharging the platform is
    // recoverable; overcharging a seller is not.
    const r = resolvePlatformFee({
      platformDefault: Number.NaN,
      now: NOW,
    })
    expect(r.percent).toBe(0)
    expect(r.source).toBe("platform_default")
  })

  it("does not treat a null plan rate as 0", () => {
    // `null` means "this plan expresses no opinion", not "this plan is free".
    const r = resolvePlatformFee({ planPercent: null, platformDefault: 3, now: NOW })
    expect(r.percent).toBe(3)
  })
})

describe("resolvePlatformFee transaction kind", () => {
  // A non-zero override AND a plan, both of which would normally win. If the
  // kind rung were below either of them, these inputs would surface 1.5 or 5.
  const contested = {
    override: {
      custom_platform_fee_percent: 1.5,
      fee_reduction_reason: "founding vendor",
      fee_reduction_expires_at: FUTURE,
    },
    planPercent: 5,
    platformDefault: 3,
    now: NOW,
  }

  it("names exactly the kinds that carry no fee", () => {
    // Pinned so a new kind cannot slip into the zero set unreviewed. `pledge`
    // is deliberately absent: collective-campaign backings and demand-pool
    // participant pledges keep their own fee paths. `pool_contribution` is a
    // contribution to a nonprofit-CARRIED pool, a direct charge on the
    // carrier's own account (Decision 7): 0 by the same mechanism as a
    // donation, recorded as an operator assumption in docs/AUDIT_DEBT.md.
    expect([...ZERO_FEE_TRANSACTION_KINDS].sort()).toEqual([
      "donation",
      "donation_pledge",
      "pool_contribution",
      "tip",
    ])
    expect(ZERO_FEE_TRANSACTION_KINDS.has("sale")).toBe(false)
    expect(
      ZERO_FEE_TRANSACTION_KINDS.has("pledge" as PlatformFeeTransactionKind)
    ).toBe(false)
  })

  it.each(["donation", "donation_pledge", "tip", "pool_contribution"] as const)(
    "charges 0 on a %s even when a non-zero override and a plan are present",
    (kind) => {
      const r = resolvePlatformFee({ ...contested, kind })
      expect(r).toEqual({
        percent: 0,
        source: "transaction_kind",
        override_expired: false,
        override_reason: null,
      })
    }
  )

  it("does not report the override as expired on a zero-fee kind", () => {
    // The override is never consulted, so there is nothing to say about its
    // expiry — an admin screen must not show "expired on …" for a donation.
    const r = resolvePlatformFee({
      ...contested,
      override: { custom_platform_fee_percent: 1, fee_reduction_expires_at: PAST },
      kind: "donation",
    })
    expect(r.override_expired).toBe(false)
    expect(r.override_reason).toBeNull()
  })

  it("leaves a sale exactly as before", () => {
    const explicit = resolvePlatformFee({ ...contested, kind: "sale" })
    const implicit = resolvePlatformFee(contested)
    expect(explicit).toEqual(implicit)
    expect(explicit).toEqual({
      percent: 1.5,
      source: "seller_override",
      override_expired: false,
      override_reason: "founding vendor",
    })
  })

  it("is distinguishable from a zero override by its source", () => {
    // Both come out at 0. The source is the only thing telling an admin screen
    // "this seller negotiated 0" apart from "this was a donation".
    const concession = resolvePlatformFee({
      override: { custom_platform_fee_percent: 0 },
      planPercent: 5,
      platformDefault: 3,
      now: NOW,
    })
    const donation = resolvePlatformFee({
      planPercent: 5,
      platformDefault: 3,
      now: NOW,
      kind: "donation",
    })
    expect(concession.percent).toBe(0)
    expect(donation.percent).toBe(0)
    expect(concession.source).toBe("seller_override")
    expect(donation.source).toBe("transaction_kind")
    expect(concession.source).not.toBe(donation.source)
  })

  it("still rejects a negative or NaN rate for a sale", () => {
    // The kind rung must not have weakened the guards below it.
    const negative = resolvePlatformFee({
      override: { custom_platform_fee_percent: -5 },
      planPercent: 4,
      platformDefault: 3,
      now: NOW,
      kind: "sale",
    })
    expect(negative.percent).toBe(4)
    expect(negative.source).toBe("plan")

    const nan = resolvePlatformFee({
      override: { custom_platform_fee_percent: Number.NaN },
      planPercent: Number.NaN,
      platformDefault: 3,
      now: NOW,
      kind: "sale",
    })
    expect(nan.percent).toBe(3)
    expect(nan.source).toBe("platform_default")
  })
})
