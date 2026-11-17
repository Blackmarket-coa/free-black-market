import { fromMinorUnits, toMinorUnits } from "../minor-units"

describe("fromMinorUnits", () => {
  it("turns cents into the major units Medusa prices in", () => {
    expect(fromMinorUnits(1200, "usd")).toBe(12)
    expect(fromMinorUnits(1999, "USD")).toBe(19.99)
    expect(fromMinorUnits(1, "usd")).toBe(0.01)
    expect(fromMinorUnits(0, "usd")).toBe(0)
    // Rounded to the minor unit: a fractional input cannot price below a cent.
    expect(fromMinorUnits(1250.4, "usd")).toBe(12.5)
  })

  it("follows the currency's minor unit", () => {
    expect(fromMinorUnits(1200, "jpy")).toBe(1200)
    expect(fromMinorUnits(12345, "kwd")).toBe(12.345)
    // Missing or unknown currency: two digits, as currencyMinorDigits says.
    expect(fromMinorUnits(1200, undefined)).toBe(12)
    expect(fromMinorUnits(1200, "not-a-currency")).toBe(12)
  })

  it("is toMinorUnits' inverse", () => {
    for (const [minor, code] of [[1200, "usd"], [2599, "eur"], [1200, "jpy"], [12345, "kwd"]] as const) {
      expect(toMinorUnits(fromMinorUnits(minor, code), code)).toBe(minor)
    }
  })

  it("is NaN for what it cannot read, never 0", () => {
    expect(fromMinorUnits("twelve", "usd")).toBeNaN()
    expect(fromMinorUnits(undefined, "usd")).toBeNaN()
  })
})
