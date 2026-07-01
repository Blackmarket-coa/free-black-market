import { describe, expect, it } from "vitest"

import {
  classNames,
  credits,
  daysUntil,
  money,
  pct,
  shortDate,
} from "./format"

describe("money", () => {
  it("formats cents as USD", () => {
    expect(money(1050)).toBe("$10.50")
    expect(money(0)).toBe("$0.00")
  })
  it("treats null/undefined as zero", () => {
    expect(money(undefined as unknown as number)).toBe("$0.00")
  })
})

describe("credits", () => {
  it("formats whole coalition credits with the ₡ symbol", () => {
    expect(credits(1500)).toBe("₡1,500")
    expect(credits(2.6)).toBe("₡3")
  })
})

describe("pct", () => {
  it("rounds to a whole-number percentage", () => {
    expect(pct(72.4)).toBe("72%")
    expect(pct(72.6)).toBe("73%")
  })
})

describe("shortDate", () => {
  it("returns an em dash for empty input", () => {
    expect(shortDate(null)).toBe("—")
    expect(shortDate(undefined)).toBe("—")
  })
  it("formats a valid ISO date", () => {
    expect(shortDate("2026-05-01")).toBe("May 1")
  })
  it("returns an em dash for an unparseable date", () => {
    expect(shortDate("not-a-date")).toBe("—")
  })
})

describe("daysUntil", () => {
  it("returns null for empty input", () => {
    expect(daysUntil(null)).toBeNull()
  })
})

describe("classNames", () => {
  it("joins truthy class fragments and drops falsey ones", () => {
    expect(classNames("a", false, null, undefined, "b")).toBe("a b")
  })
})
