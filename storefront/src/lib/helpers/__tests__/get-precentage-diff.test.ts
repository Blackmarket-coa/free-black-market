import { describe, expect, it } from "vitest"
import { getPercentageDiff } from "../get-precentage-diff"

describe("getPercentageDiff", () => {
  it("returns the rounded percentage decrease from original to calculated", () => {
    expect(getPercentageDiff(100, 75)).toBe("25")
    expect(getPercentageDiff(200, 150)).toBe("25")
  })

  it("returns '0' when there is no decrease", () => {
    expect(getPercentageDiff(100, 100)).toBe("0")
  })

  it("returns a negative percentage when the calculated price is higher", () => {
    expect(getPercentageDiff(100, 120)).toBe("-20")
  })

  it("rounds to the nearest whole number", () => {
    // diff = 33, decrease = 33%
    expect(getPercentageDiff(100, 67)).toBe("33")
    // diff = 1, decrease = 33.33% -> rounds to 33
    expect(getPercentageDiff(3, 2)).toBe("33")
  })
})
