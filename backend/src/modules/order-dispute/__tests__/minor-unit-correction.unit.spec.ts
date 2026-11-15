import { BigNumber } from "@medusajs/framework/utils"
import {
  isDryRunArg,
  legacyFlooredShare,
  minorUnitShare,
  parseCutoffArg,
  planMinorUnitCorrection,
  type MajorUnitLine,
  type StoredDisputeAmounts,
} from "../minor-unit-correction"
import {
  AMOUNT_UNIT_METADATA_KEY,
  AMOUNT_UNIT_MINOR,
  DisputeStatus,
  currencyMinorDigits,
  isMarkedMinorUnits,
  toMinorUnits,
} from "../resolution"

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
  // The fix went live at noon; the old intake's rows are older than that.
  const cutoff = { before: new Date("2026-11-20T12:00:00Z") }
  const row = (over: Partial<StoredDisputeAmounts> = {}): StoredDisputeAmounts => ({
    status: DisputeStatus.OPEN,
    seller_id: "sel_a",
    currency_code: "usd",
    claim_amount: 24,
    award_amount: 0,
    created_at: "2026-11-01T09:00:00Z",
    metadata: null,
    ...over,
  })
  const plan = (r: StoredDisputeAmounts, l: readonly MajorUnitLine[] = lines) =>
    planMinorUnitCorrection(r, l, cutoff)

  it("works out what the old intake stored and what it should have", () => {
    expect(legacyFlooredShare(lines, "sel_a")).toBe(24)
    expect(minorUnitShare(lines, "sel_a", "usd")).toBe(2598)
    expect(legacyFlooredShare(lines, "sel_b")).toBe(40)
    expect(minorUnitShare(lines, "sel_b", "usd")).toBe(4000)
  })

  it("corrects an open claim the old intake stored", () => {
    expect(plan(row(), lines)).toEqual({
      action: "correct",
      claim: { from: 24, to: 2598 },
      award: { from: 0, to: 0 },
    })
  })

  it("corrects a refund decided for the whole claim along with the claim", () => {
    expect(
      plan(row({ status: DisputeStatus.RESOLVED_REFUND, award_amount: 24 }), lines)
    ).toEqual({ action: "correct", claim: { from: 24, to: 2598 }, award: { from: 24, to: 2598 } })
  })

  it("leaves a row already in minor units alone", () => {
    expect(plan(row({ claim_amount: 2598 }), lines)).toEqual({
      action: "skip",
      reason: "already_minor_units",
    })
  })

  it("leaves a currency with no minor unit alone: the two figures are the same", () => {
    const yen: MajorUnitLine[] = [{ seller_id: "sel_a", total_major: 5000 }]
    expect(plan(row({ currency_code: "jpy", claim_amount: 5000 }), yen)).toEqual({
      action: "skip",
      reason: "no_difference",
    })
  })

  it("does not guess at a claim below the whole-order figure", () => {
    const p = plan(row({ claim_amount: 10 }), lines)
    expect(p.action).toBe("review")
  })

  it("does not guess at a partial award", () => {
    const p = plan(row({ status: DisputeStatus.RESOLVED_REFUND, award_amount: 12 }), lines)
    expect(p).toMatchObject({ action: "review" })
    expect((p as { reason: string }).reason).toContain("award 12")
  })

  it("only looks at the disputed seller's lines", () => {
    expect(plan(row({ seller_id: "sel_b", claim_amount: 40 }), lines)).toEqual({
      action: "correct",
      claim: { from: 40, to: 4000 },
      award: { from: 0, to: 0 },
    })
  })

  /**
   * The case review found: after the fix, a buyer filing through
   * POST /store/orders/:id/dispute can type claim_amount 25 on a $25.99
   * order (meaning $0.25). Its amounts are exactly an old row's, and without
   * the mark a late run would make it $25.99, and an award of the whole
   * claim with it.
   */
  it("never touches a row the fixed intake marked, even when its amounts look old", () => {
    const marked = { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR, intake_source: "store/orders/[id]/dispute" }
    expect(plan(row({ metadata: marked }))).toEqual({ action: "skip", reason: "marked_minor_units" })
    expect(plan(row({ metadata: marked, status: DisputeStatus.RESOLVED_REFUND, award_amount: 24 }))).toEqual({
      action: "skip",
      reason: "marked_minor_units",
    })
    // The same row unmarked is what the old intake wrote, and is corrected.
    expect(plan(row({ metadata: { intake_source: "store/orders/[id]/dispute" } })).action).toBe("correct")
  })

  it("reads the mark exactly: another value, or a mark that is not in metadata, is not one", () => {
    expect(isMarkedMinorUnits({ amount_unit: "minor" })).toBe(true)
    for (const md of [null, undefined, {}, { amount_unit: "major" }, { amount_unit: true }, "minor", ["minor"]]) {
      expect(isMarkedMinorUnits(md)).toBe(false)
    }
  })

  it("leaves a row created at or after the cutoff alone", () => {
    expect(plan(row({ created_at: "2026-11-20T12:00:00Z" }))).toEqual({ action: "skip", reason: "after_cutoff" })
    expect(plan(row({ created_at: new Date("2026-11-21T00:00:00Z") }))).toEqual({
      action: "skip",
      reason: "after_cutoff",
    })
    expect(plan(row({ created_at: "2026-11-20T11:59:59.999Z" })).action).toBe("correct")
  })

  it("does not guess when a row's creation time is unreadable, and needs a real cutoff", () => {
    expect(plan(row({ created_at: "not a date" })).action).toBe("review")
    expect(() => planMinorUnitCorrection(row(), lines, { before: new Date("nope") })).toThrow(/cutoff/)
  })
})

describe("the corrective script's arguments", () => {
  const now = new Date("2026-11-25T00:00:00Z")

  it("takes the cutoff as a bare word, which is the only form medusa exec passes through", () => {
    expect(parseCutoffArg(["dry-run", "before=2026-11-20T12:00:00Z"], now)).toEqual({
      ok: true,
      before: new Date("2026-11-20T12:00:00Z"),
    })
    expect(parseCutoffArg(["before=2026-11-20T07:00:00-05:00"], now)).toEqual({
      ok: true,
      before: new Date("2026-11-20T12:00:00Z"),
    })
    expect(parseCutoffArg(["--before=2026-11-20T12:00:00.500Z"], now)).toEqual({
      ok: true,
      before: new Date("2026-11-20T12:00:00.500Z"),
    })
  })

  it("refuses to run with no cutoff: `-- --dry-run --before=…` reaches the script as no arguments", () => {
    for (const args of [undefined, [], ["dry-run"], ["--dry-run"]]) {
      const parsed = parseCutoffArg(args, now)
      expect(parsed.ok).toBe(false)
      expect((parsed as { message: string }).message).toMatch(/cutoff is required/)
    }
  })

  it("refuses a cutoff it would have to guess at, or one that cannot be when the fix went live", () => {
    for (const bad of [
      "before=",
      "before=yesterday",
      "before=2026-11-20",
      "before=2026-11-20T12:00:00", // no zone: local time on whatever machine runs it
      "before=2026-13-45T12:00:00Z",
      "before=2026-11-26T00:00:00Z", // after `now`
    ]) {
      expect(parseCutoffArg([bad], now).ok).toBe(false)
    }
  })

  it("is a dry run only when asked", () => {
    expect(isDryRunArg(["dry-run", "before=2026-11-20T12:00:00Z"])).toBe(true)
    expect(isDryRunArg(["--dry-run"])).toBe(true)
    expect(isDryRunArg(["before=2026-11-20T12:00:00Z"])).toBe(false)
    expect(isDryRunArg(undefined)).toBe(false)
  })
})
