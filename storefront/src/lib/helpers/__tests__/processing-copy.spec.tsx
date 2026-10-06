import { readFileSync } from "fs"
import path from "path"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, describe, expect, it, vi } from "vitest"

import type { FeeScheduleProcessing } from "../../data/fee-schedule"
import {
  PROCESSING_COPY,
  TRANSPARENCY_PROCESSING_NEVER_CHARGED,
  feeFirstExample,
  formatUsdCents,
  processingCopy,
  type ProcessingCopyKey,
} from "../processing-copy"
import { howItWorksFeeDescription, sellPageCostAnswer, type LadderPlan } from "../fee-ladder-copy"
import { buildPlatforms } from "../../../components/sections/FeeBreakdown"
import { ProducerPriceExplanation } from "../../../components/molecules/ConversionCopy/ConversionCopy"
import { WhereYourMoneyGoes } from "../../../components/molecules/PriceTransparency/PriceTransparency"
import { featureMatrixItems, featureMatrixItemsFor } from "../../../data/featureMatrix"

/**
 * Black Mask F6: no page may say the coalition absorbs card processing while
 * /store/fee-schedule says the model is fee-first, and with the field absent
 * every page says exactly what it said before.
 */

// The components compiled for the automatic JSX runtime in Next do not import
// React; the vitest transform is classic (the ConsentBanner.spec.tsx precedent).
beforeAll(() => {
  vi.stubGlobal("React", React)
})

const FEE_FIRST: FeeScheduleProcessing = { model: "fee_first", percent: 2.9, fixed_cents: 30 }
const FEE_FIRST_NO_FIGURES: FeeScheduleProcessing = { model: "fee_first", percent: null, fixed_cents: null }
const KEYS = Object.keys(PROCESSING_COPY) as ProcessingCopyKey[]

/** Phrases that state or imply the coalition absorbs processing. */
const ABSORPTION_CLAIMS = [
  /absorb/i,
  /no (payment )?processing fees?/i,
  /processing fees? passed/i,
  /no payment processing/i,
  /covers everything/i,
  /\b97% of (every|each) sale\b(?! after card processing)/i,
  /\bkeep 97%(?! (after|of what is left|of every sale after))/i,
  /\b97 cents of every dollar\b/i,
  /payment processing,/i,
]

const assertNoAbsorptionClaim = (text: string) => {
  for (const claim of ABSORPTION_CLAIMS) {
    expect(text, `"${text}" must not match ${claim}`).not.toMatch(claim)
  }
}

describe("processingCopy with no processing field (flag off)", () => {
  it.each(KEYS)("%s renders today's sentence exactly", (key) => {
    expect(processingCopy(key, undefined)).toBe(PROCESSING_COPY[key].legacy)
    expect(processingCopy(key, null, 2.5)).toBe(PROCESSING_COPY[key].legacy)
  })

  it("keeps the sell-page and how-it-works ladder sentences byte-identical", () => {
    const plans: LadderPlan[] = [
      { display_name: "Free", price_amount: 0, currency_code: "usd", interval: "none", platform_fee_percent: 3, is_default: true },
      { display_name: "Starter", price_amount: 2900, currency_code: "usd", interval: "month", platform_fee_percent: 2.5, is_default: false },
    ]
    expect(sellPageCostAnswer(plans)).toBe(sellPageCostAnswer(plans, undefined))
    expect(sellPageCostAnswer(plans)).toMatch(
      /^Nothing upfront\. On the free plan it is 3% to the coalition when you make a sale, with no listing fees, no payment processing fees and no hidden charges/
    )
    expect(howItWorksFeeDescription(plans)).toBe(
      "No required subscription. No listing fees. No payment processing fees passed to you. 3% when you make a sale on the free plan — an optional paid plan brings it to 2.5%."
    )
  })

  it("keeps FeeBreakdown's own row exactly as it was", () => {
    const bmc = buildPlatforms(3).find((p) => p.name === "BMC")!
    expect(bmc.breakdown).toEqual([
      "3% marketplace commission",
      "No payment processing fees passed to you",
      "No listing fees",
      "No mandatory ads",
      "No monthly subscription required — paid plans are optional and lower the rate",
      "Internal ledger settlement (Coalition Credits) — internal processor coming soon",
    ])
    expect(bmc.calcFees(40)).toEqual({ commission: 40 * 0.03, processing: 0, ads: 0, fulfillment: 0, listing: 0, other: 0, total: 40 * 0.03 })
  })

  it("keeps the feature matrix exactly as it was", () => {
    expect(featureMatrixItemsFor(undefined)).toEqual(featureMatrixItems)
  })

  it("renders ProducerPriceExplanation and WhereYourMoneyGoes byte-identically", () => {
    expect(renderToStaticMarkup(<ProducerPriceExplanation />)).toBe(
      // Captured from the pre-F6 component (main d51aa0b9) rendered the same way.
      '<div class="text-sm text-gray-600 mt-2"><span class="font-medium text-green-700">97% goes to the producer.</span> A flat 3% coalition fee keeps the marketplace running — no listing, monthly, or payment processing fees passed to vendors.</div>'
    )
    const bar = renderToStaticMarkup(<WhereYourMoneyGoes producerPercent={97} platformPercent={3} />)
    expect(bar).not.toContain("Card processing")
    expect(bar).not.toContain("bg-gray-400")
  })
})

describe("processingCopy with processing.model fee_first (flag on)", () => {
  it.each(KEYS)("%s makes no absorption claim", (key) => {
    for (const p of [FEE_FIRST, FEE_FIRST_NO_FIGURES]) {
      const text = processingCopy(key, p, 3)
      expect(text).not.toBe(PROCESSING_COPY[key].legacy)
      assertNoAbsorptionClaim(text)
    }
  })

  it("says plainly that processing comes off first and the 3% is taken on what is left", () => {
    expect(processingCopy("sellBenefitBody", FEE_FIRST, 3)).toBe(
      "Card processing (estimated 2.9% + 30¢) comes off each sale first. Then a 3% coalition fee on the free plan, and lower on a paid plan, is taken on what is left. No listing fees."
    )
    expect(processingCopy("howItWorksCoverFaq", FEE_FIRST, 3)).toContain(
      "Card processing is not inside the 3%: the estimate (2.9% + 30¢) comes off each sale first, and the 3% is taken on what is left."
    )
    expect(processingCopy("transparencyCheckIt", FEE_FIRST)).toContain("the processing is not")
  })

  it("quotes the backend's figures, and the documented default only when it sent none", () => {
    expect(processingCopy("vendorTypesHiddenFees", { model: "fee_first", percent: 3.4, fixed_cents: 25 })).toContain(
      "estimated 3.4% + 25¢"
    )
    expect(processingCopy("vendorTypesHiddenFees", FEE_FIRST_NO_FIGURES)).toContain("estimated 2.9% + 30¢")
  })

  it("drops the 'passed through to you' row rather than rewording it", () => {
    // The transparency page filters this row out under fee-first; the row
    // itself is today's text and is an absorption claim.
    expect(() => assertNoAbsorptionClaim(TRANSPARENCY_PROCESSING_NEVER_CHARGED.detail)).toThrow()
    const source = readFileSync(
      path.join(__dirname, "../../../app/[locale]/(main)/transparency/page.tsx"),
      "utf8"
    )
    expect(source).toContain("...(isFeeFirst(processing) ? [] : [TRANSPARENCY_PROCESSING_NEVER_CHARGED])")
  })

  it("FeeBreakdown's row takes processing first, the commission on what is left", () => {
    const bmc = buildPlatforms(3, FEE_FIRST).find((p) => p.name === "BMC")!
    for (const line of bmc.breakdown) assertNoAbsorptionClaim(line)
    expect(bmc.breakdown[0]).toBe("3% marketplace commission on what is left")
    expect(bmc.breakdown[1]).toBe("Card processing (estimated 2.9% + 30¢) comes off the sale first")
    const fees = bmc.calcFees(40)
    expect(fees.processing).toBeCloseTo(1.46, 10)
    expect(fees.commission).toBeCloseTo((40 - 1.46) * 0.03, 10)
    expect(fees.total).toBeCloseTo(fees.processing + fees.commission, 10)
  })

  it("renders ProducerPriceExplanation and WhereYourMoneyGoes without an absorption claim", () => {
    const text = textOf(renderToStaticMarkup(<ProducerPriceExplanation processing={FEE_FIRST} />))
    assertNoAbsorptionClaim(text)
    expect(text).toContain("97% of what is left after card processing goes to the producer.")
    const bar = renderToStaticMarkup(
      <WhereYourMoneyGoes producerPercent={93.9} platformPercent={2.9} processingPercent={3.2} />
    )
    expect(bar).toContain("3.2% card processing (estimate)")
  })

  it("the feature matrix payouts row is qualified", () => {
    const row = featureMatrixItemsFor(FEE_FIRST).find((i) => i.capability === "Stripe direct payouts")!
    assertNoAbsorptionClaim(row.description)
    expect(row.description).toContain("after card processing")
  })
})

/**
 * Visible text of server-rendered markup, for assertions only. Tags are
 * removed until none remain: a single pass can leave a tag behind (e.g.
 * `<<b>script>`), which CodeQL rightly flags as incomplete sanitization.
 */
function textOf(markup: string): string {
  let previous: string
  let text = markup
  do {
    previous = text
    text = text.replace(/<[^>]*>/g, "")
  } while (text !== previous)
  return text
}

describe("feeFirstExample mirrors the settlement's arithmetic", () => {
  it.each([
    [4000, 3, 146, 116, 3738],
    [4000, 0, 146, 0, 3854],
    [500, 3, 45, 14, 441],
    [10_000, 3, 320, 290, 9390],
    [1500, 3, 74, 43, 1383],
  ])("%i cents at %d%%: processing %i, commission %i, keep %i", (sale, fee, processing, commission, keep) => {
    expect(feeFirstExample(sale, fee, FEE_FIRST)).toEqual({
      processingCents: processing,
      commissionCents: commission,
      keepCents: keep,
    })
  })

  it("formats integer cents", () => {
    expect(formatUsdCents(320)).toBe("$3.20")
    expect(formatUsdCents(9390)).toBe("$93.90")
    expect(formatUsdCents(5)).toBe("$0.05")
  })
})

describe("no absorption claim left as a literal in a page", () => {
  const read = (rel: string) => readFileSync(path.join(__dirname, "../../..", rel), "utf8")
  const PAGES = [
    "app/[locale]/(main)/page.tsx",
    "app/[locale]/(main)/why-we-exist/page.tsx",
    "app/[locale]/(main)/what-you-sell/page.tsx",
    "app/[locale]/(main)/vendor-types/page.tsx",
    "app/[locale]/(main)/sell/SellPageClient.tsx",
    "app/[locale]/(main)/creators/page.tsx",
    "app/[locale]/(main)/how-it-works/page.tsx",
    "app/[locale]/(main)/transparency/page.tsx",
    "components/sections/FeeBreakdown.tsx",
    "data/featureMatrix.ts",
    "lib/helpers/fee-ladder-copy.ts",
  ]

  it.each(PAGES)("%s renders every processing sentence from processing-copy", (rel) => {
    // Comments may describe the old model; rendered strings may not hold it.
    const code = read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    for (const literal of [
      "absorb",
      "processing fees",
      "97% of every sale",
      "97% of each sale",
      "Keep 97%",
      "keep 97%",
      "97 cents of every dollar",
      "Ninety-seven cents",
      "covers everything",
      "stays simple: one transparent",
      "97% Revenue Share",
      ">To Creators<",
      ">Goes to Creators<",
      ">Goes to the Coalition<",
    ]) {
      expect(code, `${rel} still holds "${literal}" as a literal`).not.toContain(literal)
    }
  })
})
