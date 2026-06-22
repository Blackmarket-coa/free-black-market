import { describe, expect, it } from "vitest"
import { convertToLocale } from "../money"

describe("convertToLocale", () => {
  it("formats an amount as a localized currency string", () => {
    expect(convertToLocale({ amount: 1234.5, currency_code: "usd" })).toBe(
      "$1,234.50"
    )
  })

  it("honours the provided locale", () => {
    const formatted = convertToLocale({
      amount: 1000,
      currency_code: "eur",
      locale: "de-DE",
    })
    // de-DE uses a non-breaking space and trailing symbol; assert the digits + symbol survive
    expect(formatted).toContain("1.000")
    expect(formatted).toContain("€")
  })

  it("respects fraction-digit overrides", () => {
    expect(
      convertToLocale({
        amount: 9,
        currency_code: "usd",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    ).toBe("$9")
  })

  it("falls back to the raw amount string when currency_code is missing", () => {
    expect(convertToLocale({ amount: 42, currency_code: "" })).toBe("42")
  })
})
