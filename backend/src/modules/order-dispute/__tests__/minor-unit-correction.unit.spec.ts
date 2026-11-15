import { BigNumber } from "@medusajs/framework/utils"
import {
  legacyFlooredShare,
  minorUnitShare,
  planMinorUnitCorrection,
  type MajorUnitLine,
} from "../minor-unit-correction"
import { DisputeStatus, currencyMinorDigits, toMinorUnits } from "../resolution"

describe("toMinorUnits", () => {
  it("turns Medusa's major units into the currency's minor unit", () => {
    expect(toMinorUnits(25.99, "usd")).toBe(2599)
    expect(toMinorUnits(12.99 + 12.99, "usd")).toBe(2598)
    expect(toMinorUnits(new BigNumber(25.99), "usd")).toBe(2599)
    expect(toMinorUnits("8.57", "USD")).toBe(857)
    expect(toMinorUnits(5000, "jpy")).toBe(5000)
    expect(toMinorUnits(1.234, "kwd")).toBe(1234)
  })

  it("rounds a half minor unit up, after dropping binary noise", () => {
    // 0.285 * 100 is 28.499999999999996 in binary floating point.
    expect(toMinorUnits(0.285, "usd")).toBe(29)
    expect(toMinorUnits(12.994, "usd")).toBe(1299)
  })

  it("reads anything unreadable as nothing", () => {
    for (const bad of [undefined, null, "abc", {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toMinorUnits(bad, "usd")).toBe(0)
    }
  })

  it("knows each currency's digits, and assumes two for one it does not know", () => {
    expect(currencyMinorDigits("usd")).toBe(2)
    expect(currencyMinorDigits("JPY")).toBe(0)
    expect(currencyMinorDigits("kwd")).toBe(3)
    expect(currencyMinorDigits("not-a-currency")).toBe(2)
    expect(currencyMinorDigits(null)).toBe(2)
  })
})

describe("planMinorUnitCorrection", () => {
  const lines: MajorUnitLine[] = [
    { seller_id: "sel_a", total_major: 12.99 },
    { seller_id: "sel_a", total_major: 12.99 },
    { seller_id: "sel_b", total_major: 40 },
  ]
  const row = (over: Partial<Parameters<typeof planMinorUnitCorrection>[0]> = {}) => ({
    status: DisputeStatus.OPEN,
    seller_id: "sel_a",
    currency_code: "usd",
    claim_amount: 24,
    award_amount: 0,
    ...over,
  })

  it("works out what the old intake stored and what it should have", () => {
    expect(legacyFlooredShare(lines, "sel_a")).toBe(24)
    expect(minorUnitShare(lines, "sel_a", "usd")).toBe(2598)
    expect(legacyFlooredShare(lines, "sel_b")).toBe(40)
    expect(minorUnitShare(lines, "sel_b", "usd")).toBe(4000)
  })

  it("corrects an open claim the old intake stored", () => {
    expect(planMinorUnitCorrection(row(), lines)).toEqual({
      action: "correct",
      claim: { from: 24, to: 2598 },
      award: { from: 0, to: 0 },
    })
  })

  it("corrects a refund decided for the whole claim along with the claim", () => {
    expect(
      planMinorUnitCorrection(row({ status: DisputeStatus.RESOLVED_REFUND, award_amount: 24 }), lines)
    ).toEqual({ action: "correct", claim: { from: 24, to: 2598 }, award: { from: 24, to: 2598 } })
  })

  it("leaves a row already in minor units alone", () => {
    expect(planMinorUnitCorrection(row({ claim_amount: 2598 }), lines)).toEqual({
      action: "skip",
      reason: "already_minor_units",
    })
  })

  it("leaves a currency with no minor unit alone: the two figures are the same", () => {
    const yen: MajorUnitLine[] = [{ seller_id: "sel_a", total_major: 5000 }]
    expect(planMinorUnitCorrection(row({ currency_code: "jpy", claim_amount: 5000 }), yen)).toEqual({
      action: "skip",
      reason: "no_difference",
    })
  })

  it("does not guess at a claim below the whole-order figure", () => {
    const plan = planMinorUnitCorrection(row({ claim_amount: 10 }), lines)
    expect(plan.action).toBe("review")
  })

  it("does not guess at a partial award", () => {
    const plan = planMinorUnitCorrection(row({ status: DisputeStatus.RESOLVED_REFUND, award_amount: 12 }), lines)
    expect(plan).toMatchObject({ action: "review" })
    expect((plan as { reason: string }).reason).toContain("award 12")
  })

  it("only looks at the disputed seller's lines", () => {
    expect(planMinorUnitCorrection(row({ seller_id: "sel_b", claim_amount: 40 }), lines)).toEqual({
      action: "correct",
      claim: { from: 40, to: 4000 },
      award: { from: 0, to: 0 },
    })
  })
})
