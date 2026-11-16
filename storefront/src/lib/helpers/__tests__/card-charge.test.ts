import { describe, expect, it } from "vitest"
import { cardChargeMatchesCartTotal, minorUnitDigits } from "../card-charge"

describe("cardChargeMatchesCartTotal", () => {
  const usd = (total: number) => ({ total, currency_code: "usd" })

  it("is true when the session was opened for the cart's total", () => {
    expect(cardChargeMatchesCartTotal({ amount: 59.97 }, usd(59.97))).toBe(true)
    expect(cardChargeMatchesCartTotal({ amount: 20 }, usd(20))).toBe(true)
  })

  it("is false when the total moved after the session was opened", () => {
    // The reprice the review measured: a 20.00 session, a 13.00 cart.
    expect(cardChargeMatchesCartTotal({ amount: 20 }, usd(13))).toBe(false)
    // One cent is a different charge.
    expect(cardChargeMatchesCartTotal({ amount: 59.97 }, usd(59.96))).toBe(false)
    expect(cardChargeMatchesCartTotal({ amount: 59.96 }, usd(59.97))).toBe(false)
  })

  it("compares what Stripe is sent and what the buyer reads, not float noise", () => {
    // 19.99 * 3 is 59.97 with a float tail; both are 5997 cents.
    expect(cardChargeMatchesCartTotal({ amount: 19.99 * 3 }, usd(59.97))).toBe(true)
    expect(cardChargeMatchesCartTotal({ amount: 0.1 + 0.2 }, usd(0.3))).toBe(true)
  })

  it("uses the currency's own minor unit", () => {
    expect(minorUnitDigits("usd")).toBe(2)
    expect(minorUnitDigits("jpy")).toBe(0)
    expect(minorUnitDigits("kwd")).toBe(3)
    expect(minorUnitDigits(null)).toBe(2)
    expect(minorUnitDigits("not-a-currency")).toBe(2)

    // One fils is a different charge in dinar; a fraction of a yen is none.
    expect(cardChargeMatchesCartTotal({ amount: 1.001 }, { total: 1.002, currency_code: "kwd" })).toBe(false)
    expect(cardChargeMatchesCartTotal({ amount: 1200.2 }, { total: 1200, currency_code: "jpy" })).toBe(true)
    expect(cardChargeMatchesCartTotal({ amount: 1201 }, { total: 1200, currency_code: "jpy" })).toBe(false)
  })

  it("is false when either amount is not a number", () => {
    expect(cardChargeMatchesCartTotal(undefined, usd(20))).toBe(false)
    expect(cardChargeMatchesCartTotal(null, usd(20))).toBe(false)
    expect(cardChargeMatchesCartTotal({}, usd(20))).toBe(false)
    expect(cardChargeMatchesCartTotal({ amount: null }, { total: 0, currency_code: "usd" })).toBe(false)
    expect(cardChargeMatchesCartTotal({ amount: "20" }, usd(20))).toBe(false)
    expect(cardChargeMatchesCartTotal({ amount: Number.NaN }, usd(20))).toBe(false)
    expect(cardChargeMatchesCartTotal({ amount: 20 }, { currency_code: "usd" })).toBe(false)
    expect(cardChargeMatchesCartTotal({ amount: 20 }, null)).toBe(false)
  })
})
