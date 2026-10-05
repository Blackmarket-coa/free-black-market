import { readFileSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

import {
  formatPlanPrice,
  howItWorksFeeDescription,
  joinWithAnd,
  joinWithOr,
  paidPlansSentence,
  sellPageCostAnswer,
  trialSentence,
  type LadderPlan,
} from "../fee-ladder-copy"

/**
 * The ladder prose is rendered from `/store/fee-schedule` so retiring a tier
 * cannot leave stale copy behind (Black Mask F8). The schedules below are the
 * backend's responses in each flag state — the same rows the backend spec
 * `api/store/fee-schedule/__tests__/route.unit.spec.ts` pins.
 */

const plan = (over: Partial<LadderPlan> & Pick<LadderPlan, "display_name">): LadderPlan => ({
  price_amount: 0,
  currency_code: "usd",
  interval: "month",
  platform_fee_percent: 3,
  is_default: false,
  ...over,
})

/**
 * /store/fee-schedule `plans` with FF_ALL_ACCESS_PLAN_V1 off (today). No
 * `trial_days`: the flag-off response is byte-identical to the pre-F8 one.
 */
const FLAG_OFF: LadderPlan[] = [
  plan({ display_name: "Free", interval: "none", platform_fee_percent: 3, is_default: true }),
  plan({ display_name: "Starter", price_amount: 2900, platform_fee_percent: 2.5 }),
  plan({ display_name: "Pro", price_amount: 9900, platform_fee_percent: 2 }),
  plan({ display_name: "Scale", price_amount: 24900, platform_fee_percent: 1.5 }),
]

/** /store/fee-schedule `plans` with FF_ALL_ACCESS_PLAN_V1 on (`trial_days` present). */
const FLAG_ON: LadderPlan[] = [
  plan({ display_name: "Free", interval: "none", platform_fee_percent: 3, is_default: true, trial_days: 0 }),
  plan({ display_name: "All-Access", price_amount: 1000, platform_fee_percent: 0, trial_days: 30 }),
]

describe("ladder copy with the flag off says exactly what the pages said before", () => {
  it("sell page: the cost FAQ, character for character", () => {
    expect(sellPageCostAnswer(FLAG_OFF)).toBe(
      "Nothing upfront. On the free plan it is 3% to the coalition when you make a sale, with no listing fees, no payment processing fees and no hidden charges — if you don't sell, you don't pay. Paid plans are optional and lower the rate: Starter $29/mo for 2.5%, Pro $99/mo for 2%, Scale $249/mo for 1.5%. Starter and Pro include a 30-day free trial."
    )
  })

  it("how-it-works: the fee card, character for character", () => {
    expect(howItWorksFeeDescription(FLAG_OFF)).toBe(
      "No required subscription. No listing fees. No payment processing fees passed to you. 3% when you make a sale on the free plan — optional paid plans bring it to 2.5%, 2% or 1.5%."
    )
  })
})

describe("ladder copy with the flag on", () => {
  it("names the all-access plan and none of the retired tiers", () => {
    const answer = sellPageCostAnswer(FLAG_ON)
    expect(answer).toContain("All-Access $10/mo for 0%")
    expect(answer).toContain("All-Access includes a 30-day free trial.")
    for (const stale of ["$29", "$99", "$249", "Starter", "Pro", "Scale", "2.5%", "1.5%"]) {
      expect(answer).not.toContain(stale)
    }
    // The free default is unchanged.
    expect(answer).toContain("On the free plan it is 3%")
  })

  it("quotes the single offered rate on how-it-works", () => {
    expect(howItWorksFeeDescription(FLAG_ON)).toBe(
      "No required subscription. No listing fees. No payment processing fees passed to you. 3% when you make a sale on the free plan — an optional paid plan brings it to 0%."
    )
  })
})

describe("ladder copy when the schedule could not be fetched", () => {
  it("quotes no plan at all rather than a stale one", () => {
    expect(sellPageCostAnswer([])).toBe(
      "Nothing upfront. On the free plan it is 3% to the coalition when you make a sale, with no listing fees, no payment processing fees and no hidden charges — if you don't sell, you don't pay. Paid plans are optional and lower the rate."
    )
    expect(howItWorksFeeDescription([])).toBe(
      "No required subscription. No listing fees. No payment processing fees passed to you. 3% when you make a sale on the free plan."
    )
  })
})

describe("formatting helpers", () => {
  it("formats integer cents without float drift", () => {
    expect(formatPlanPrice(plan({ display_name: "x", price_amount: 2900 }))).toBe("$29/mo")
    expect(formatPlanPrice(plan({ display_name: "x", price_amount: 2950 }))).toBe("$29.50/mo")
    expect(formatPlanPrice(plan({ display_name: "x", price_amount: 1005, interval: "year" }))).toBe("$10.05/yr")
    expect(formatPlanPrice(plan({ display_name: "x", price_amount: 0, interval: "none" }))).toBe("$0")
  })

  it("joins lists the way the old prose did", () => {
    expect(joinWithOr(["2.5%", "2%", "1.5%"])).toBe("2.5%, 2% or 1.5%")
    expect(joinWithOr(["0%"])).toBe("0%")
    expect(joinWithAnd(["Starter", "Pro"])).toBe("Starter and Pro")
    expect(joinWithAnd(["A", "B", "C"])).toBe("A, B and C")
  })

  it("groups trials by length and skips plans without one", () => {
    // Flag off (no trial_days anywhere): the sentence the page always printed.
    expect(trialSentence(FLAG_OFF)).toBe("Starter and Pro include a 30-day free trial.")
    // ...but never once Starter or Pro has left the schedule.
    expect(trialSentence(FLAG_OFF.filter((p) => p.display_name !== "Pro"))).toBe("")
    // Stated trial_days are read as data, grouped by length.
    expect(
      trialSentence([
        plan({ display_name: "A", price_amount: 100, trial_days: 14 }),
        plan({ display_name: "B", price_amount: 200, trial_days: 30 }),
        plan({ display_name: "C", price_amount: 300, trial_days: 30 }),
        plan({ display_name: "D", price_amount: 400, trial_days: 0 }),
      ])
    ).toBe("A includes a 14-day free trial. B and C include a 30-day free trial.")
    expect(trialSentence([plan({ display_name: "Free", is_default: true, price_amount: 0 })])).toBe("")
    expect(paidPlansSentence([])).toBe("Paid plans are optional and lower the rate.")
  })
})

describe("no hand-written ladder left in the pages", () => {
  const page = (rel: string) =>
    readFileSync(path.join(__dirname, "../../../app/[locale]/(main)", rel), "utf8")

  it.each(["sell/SellPageClient.tsx", "how-it-works/page.tsx", "transparency/page.tsx"])(
    "%s quotes no paid-tier price or rate by hand",
    (rel) => {
      const source = page(rel)
      for (const stale of ["$29", "$99", "$249", "2.5%, 2% or 1.5%", "Starter and Pro include"]) {
        expect(source).not.toContain(stale)
      }
    }
  )
})
