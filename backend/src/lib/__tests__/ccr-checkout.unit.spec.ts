import {
  CCR_CENTS_PER_CREDIT_ENV,
  ccrCartIdempotencyKey,
  quoteCreditApplication,
  resolveCentsPerCredit,
} from "../ccr-checkout"

/**
 * Pure arithmetic for applying Coalition Credits to a cart. Asserted to the
 * cent without a container, the way `payout-breakdown`'s share computations
 * are — the fractional-vs-rounded mismatch between `hawala-order-payment.ts`
 * and `payout-breakdown/service.ts` is exactly the defect class these pin.
 */

describe("resolveCentsPerCredit", () => {
  it("is null when unset, so the feature fails safe rather than guessing a rate", () => {
    expect(resolveCentsPerCredit({})).toBeNull()
    expect(resolveCentsPerCredit({ [CCR_CENTS_PER_CREDIT_ENV]: "" })).toBeNull()
  })

  it("reads a positive integer rate", () => {
    expect(resolveCentsPerCredit({ [CCR_CENTS_PER_CREDIT_ENV]: "1" })).toBe(1)
    expect(resolveCentsPerCredit({ [CCR_CENTS_PER_CREDIT_ENV]: "25" })).toBe(25)
  })

  it("rejects rather than clamps a nonsense rate", () => {
    // A bad value disables the feature; it must never become a different rate.
    for (const bad of ["0", "-5", "1.5", "abc", "Infinity", "NaN"]) {
      expect(resolveCentsPerCredit({ [CCR_CENTS_PER_CREDIT_ENV]: bad })).toBeNull()
    }
  })
})

describe("quoteCreditApplication", () => {
  const rate = 10 // 1 credit = 10c

  it("returns the full subtotal and applies nothing when no rate is configured", () => {
    const q = quoteCreditApplication({
      subtotalCents: 2000,
      walletCredits: 500,
      requestedCredits: 500,
      centsPerCredit: null,
    })

    expect(q).toEqual({
      creditsApplied: 0,
      valueCents: 0,
      cashDueCents: 2000,
      limitedBy: "disabled",
    })
  })

  it("applies the requested credits when balance and subtotal both allow", () => {
    const q = quoteCreditApplication({
      subtotalCents: 2000,
      walletCredits: 500,
      requestedCredits: 50,
      centsPerCredit: rate,
    })

    expect(q.creditsApplied).toBe(50)
    expect(q.valueCents).toBe(500)
    expect(q.cashDueCents).toBe(1500)
    expect(q.limitedBy).toBe("none")
  })

  it("caps at the wallet balance", () => {
    const q = quoteCreditApplication({
      subtotalCents: 10_000,
      walletCredits: 30,
      requestedCredits: 500,
      centsPerCredit: rate,
    })

    expect(q.creditsApplied).toBe(30)
    expect(q.valueCents).toBe(300)
    expect(q.cashDueCents).toBe(9_700)
    expect(q.limitedBy).toBe("balance")
  })

  it("caps at the subtotal, so a cart can never be overpaid with credits", () => {
    const q = quoteCreditApplication({
      subtotalCents: 250,
      walletCredits: 10_000,
      requestedCredits: 10_000,
      centsPerCredit: rate,
    })

    expect(q.creditsApplied).toBe(25)
    expect(q.valueCents).toBe(250)
    expect(q.cashDueCents).toBe(0)
    expect(q.limitedBy).toBe("subtotal")
  })

  it("never returns a negative cash due, at any input", () => {
    for (const subtotal of [0, 1, 7, 99, 100, 2501]) {
      for (const credits of [0, 1, 3, 1000]) {
        const q = quoteCreditApplication({
          subtotalCents: subtotal,
          walletCredits: credits,
          requestedCredits: credits,
          centsPerCredit: rate,
        })
        expect(q.cashDueCents).toBeGreaterThanOrEqual(0)
        expect(q.valueCents).toBeLessThanOrEqual(subtotal)
      }
    }
  })

  it("floors to whole credits, leaving the remainder in the wallet", () => {
    // 7c subtotal at 10c/credit: not even one whole credit fits.
    const q = quoteCreditApplication({
      subtotalCents: 7,
      walletCredits: 100,
      requestedCredits: 100,
      centsPerCredit: rate,
    })

    expect(q.creditsApplied).toBe(0)
    expect(q.cashDueCents).toBe(7)
    expect(q.limitedBy).toBe("subtotal")
  })

  it("leaves an exact-fit cart at zero cash due with no rounding residue", () => {
    const q = quoteCreditApplication({
      subtotalCents: 1000,
      walletCredits: 100,
      requestedCredits: 100,
      centsPerCredit: rate,
    })

    expect(q.creditsApplied).toBe(100)
    expect(q.valueCents).toBe(1000)
    expect(q.cashDueCents).toBe(0)
  })

  it("value plus cash due always reconstructs the subtotal exactly", () => {
    // The invariant that matters: credits + cash = what was owed. No cent
    // may be created or lost, at any rate or quantity.
    for (const r of [1, 3, 10, 25, 100]) {
      for (const subtotal of [0, 1, 99, 100, 333, 2500, 99_999]) {
        for (const balance of [0, 1, 7, 250, 100_000]) {
          const q = quoteCreditApplication({
            subtotalCents: subtotal,
            walletCredits: balance,
            requestedCredits: balance,
            centsPerCredit: r,
          })
          expect(q.valueCents + q.cashDueCents).toBe(subtotal)
          expect(q.valueCents).toBe(q.creditsApplied * r)
        }
      }
    }
  })

  it("treats negative and fractional inputs as their floored, non-negative selves", () => {
    const q = quoteCreditApplication({
      subtotalCents: -500,
      walletCredits: -10,
      requestedCredits: 5.9,
      centsPerCredit: rate,
    })

    expect(q.creditsApplied).toBe(0)
    expect(q.cashDueCents).toBe(0)
  })

  it("applies nothing when the buyer asks for nothing", () => {
    const q = quoteCreditApplication({
      subtotalCents: 2000,
      walletCredits: 500,
      requestedCredits: 0,
      centsPerCredit: rate,
    })

    expect(q.creditsApplied).toBe(0)
    expect(q.cashDueCents).toBe(2000)
    expect(q.limitedBy).toBe("none")
  })
})

describe("ccrCartIdempotencyKey", () => {
  it("is stable per cart so a retried leg replays instead of double-moving", () => {
    expect(ccrCartIdempotencyKey.settle("cart_1")).toBe(
      ccrCartIdempotencyKey.settle("cart_1")
    )
    expect(ccrCartIdempotencyKey.release("cart_1")).toBe(
      ccrCartIdempotencyKey.release("cart_1")
    )
  })

  it("distinguishes the three legs, so a settle can never replay a release", () => {
    const keys = new Set([
      ccrCartIdempotencyKey.apply("cart_1", 5),
      ccrCartIdempotencyKey.settle("cart_1"),
      ccrCartIdempotencyKey.release("cart_1"),
    ])
    expect(keys.size).toBe(3)
  })

  it("varies the apply key by credit count, since changing the amount is a new reservation", () => {
    expect(ccrCartIdempotencyKey.apply("cart_1", 5)).not.toBe(
      ccrCartIdempotencyKey.apply("cart_1", 6)
    )
  })
})
