import type { FeeScheduleProcessing } from "../data/fee-schedule"
import {
  FALLBACK_PROCESSING_FIXED_CENTS,
  FALLBACK_PROCESSING_PERCENT,
} from "../constants/fees"

/**
 * Every public sentence about card processing, rendered from
 * `/store/fee-schedule`'s `processing` field (Black Mask F6).
 *
 * Before F6 the coalition absorbed card processing, and about twenty
 * sentences across the site say so — "no payment processing fees passed to
 * you — we absorb those", "keep 97% of every sale", "$100 sale, you keep
 * $97.00". With FF_FEE_FIRST_SPLIT_V1 on, the card-processing estimate comes
 * off the sale FIRST and the coalition's fee is taken on what is left, so
 * every one of those becomes false. A money claim that is false is a defect,
 * not a copy nit, so none of them is left in a page as a literal: each page
 * renders the entry here, and the spec fails on any absorption claim left in
 * a page or in a fee-first variant.
 *
 * `legacy` is today's sentence character for character (JSX entities decoded,
 * line breaks collapsed the way JSX collapses them), so with the field absent
 * every page renders exactly what it did. `feeFirst` is the plain statement:
 * card processing (estimated 2.9% + 30¢) comes off the sale first and the
 * coalition's fee is taken on what is left.
 */

export type ProcessingInfo = FeeScheduleProcessing | null | undefined

export const isFeeFirst = (p: ProcessingInfo): p is FeeScheduleProcessing =>
  p?.model === "fee_first"

/** The estimate's figures: the backend's, or the documented default when it sent none. */
export function processingFigures(p: ProcessingInfo): { percent: number; fixedCents: number } {
  return {
    percent: p?.percent ?? FALLBACK_PROCESSING_PERCENT,
    fixedCents: p?.fixed_cents ?? FALLBACK_PROCESSING_FIXED_CENTS,
  }
}

/** "2.9% + 30¢" */
export function processingEstimateText(p: ProcessingInfo): string {
  const { percent, fixedCents } = processingFigures(p)
  return `${percent}% + ${fixedCents}¢`
}

/** "card processing (estimated 2.9% + 30¢)" */
export const cardProcessing = (p: ProcessingInfo) =>
  `card processing (estimated ${processingEstimateText(p)})`

const keep = (feePercent: number) => `${Number((100 - feePercent).toFixed(2))}%`

/**
 * The worked example on one sale, in integer cents, with the backend's
 * rounding (`backend/src/modules/payout-breakdown/fee-first.ts`): estimate on
 * the whole sale with the fixed part once, commission on what is left.
 * Pinned against the operator's examples ($40 → 146 / 116 / 3738).
 */
export function feeFirstExample(
  saleCents: number,
  feePercent: number,
  p: ProcessingInfo
): { processingCents: number; commissionCents: number; keepCents: number } {
  const { percent, fixedCents } = processingFigures(p)
  const pct = (amount: number, rate: number) => {
    const scaled = Math.round(rate * 10_000)
    return Math.floor((2 * amount * scaled + 1_000_000) / 2_000_000)
  }
  const processing = Math.min(saleCents > 0 ? pct(saleCents, percent) + Math.round(fixedCents) : 0, saleCents)
  const commission = Math.min(pct(Math.max(0, saleCents - processing), feePercent), saleCents - processing)
  return {
    processingCents: processing,
    commissionCents: commission,
    keepCents: saleCents - processing - commission,
  }
}

/** "$3.20" — integer cents in, no float drift out. */
export function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(Math.round(cents))
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}

type CopyEntry = {
  /** Today's sentence, exactly. */
  legacy: string
  /** The fee-first sentence. */
  feeFirst: (p: FeeScheduleProcessing, feePercent: number) => string
}

const entry = (legacy: string, feeFirst: CopyEntry["feeFirst"]): CopyEntry => ({ legacy, feeFirst })

export const PROCESSING_COPY = {
  // ---- home (app/[locale]/(main)/page.tsx)
  homeMetaDescription: entry(
    "One platform for producers, creators, organizers, and service providers. Sell goods, offer services, run subscriptions, host events, and track community impact while keeping 97% of every sale.",
    (_p, f) =>
      `One platform for producers, creators, organizers, and service providers. Sell goods, offer services, run subscriptions, host events, and track community impact while keeping ${keep(f)} of every sale after card processing.`
  ),
  homeHeroParagraph: entry(
    "Free Black Market is community-owned commerce for goods, services, local food and CSA, creators, and mutual aid. Shoppers buy directly from makers whose identity and practices we verify — no middlemen, no markups. Vendors launch fast and keep 97% of every sale, with a flat 3% coalition fee and no listing, monthly, or processing fees passed to you.",
    (p, f) =>
      `Free Black Market is community-owned commerce for goods, services, local food and CSA, creators, and mutual aid. Shoppers buy directly from makers whose identity and practices we verify — no middlemen, no markups. Vendors launch fast with a flat ${f}% coalition fee and no listing or monthly fees: ${cardProcessing(p)} comes off each sale first, and the ${f}% is taken on what is left.`
  ),
  homeVendorStack: entry(
    "Stop renting your business from extractive platforms. Own your customer relationship, sell across every model from one account, and keep 97% of what you earn — no listing, monthly, or processing fees.",
    (_p, f) =>
      `Stop renting your business from extractive platforms. Own your customer relationship, sell across every model from one account, and keep ${keep(f)} of what is left after card processing — no listing or monthly fees.`
  ),
  homeComparison: entry(
    "Etsy, Shopify, Amazon, and delivery apps stack listing fees, monthly subscriptions, ad spend, and fulfillment charges — often 15–30% all-in. Our model stays simple: one transparent 3% coalition fee. Settle through our internal ledger (Coalition Credits) to move value between members with no card processing cost — an internal payment processor is coming soon.",
    (p, f) =>
      `Etsy, Shopify, Amazon, and delivery apps stack listing fees, monthly subscriptions, ad spend, and fulfillment charges — often 15–30% all-in. Our model stays simple: ${cardProcessing(p)} comes off the sale first, then one transparent ${f}% coalition fee on what is left. Settle through our internal ledger (Coalition Credits) to move value between members with no card processing cost — an internal payment processor is coming soon.`
  ),
  homeFinancialsHeading: entry("The financials: you keep 97%", (_p, f) => `The financials: you keep ${keep(f)} after card processing`),
  homeFinancialsBody: entry(
    "A 3% coalition fee on the free plan, lower on an optional paid plan. No listing fees, and no payment processing fees passed to you. Transparent ACH payouts with vendor-controlled fulfillment.",
    (p, f) =>
      `${capitalise(cardProcessing(p))} comes off the sale first; then a ${f}% coalition fee on the free plan, lower on an optional paid plan, is taken on what is left. No listing fees. Transparent ACH payouts with vendor-controlled fulfillment.`
  ),

  // ---- why-we-exist
  whyThreePercent: entry(
    "A flat coalition fee keeps costs understandable. Vendors keep 97% of each sale — no listing, monthly, or payment processing fees passed to them. Settle through our internal ledger (Coalition Credits) and an internal payment processor, coming soon, to keep even more value inside the community.",
    (p, f) =>
      `A flat coalition fee keeps costs understandable. ${capitalise(cardProcessing(p))} comes off each sale first, and vendors keep ${keep(f)} of what is left — no listing or monthly fees. Settle through our internal ledger (Coalition Credits) and an internal payment processor, coming soon, to keep even more value inside the community.`
  ),
  whyCreatorsCard: entry(
    "Own your storefront, audience, and referrals — and keep 97% of every sale.",
    (_p, f) => `Own your storefront, audience, and referrals — and keep ${keep(f)} of every sale after card processing.`
  ),

  // ---- what-you-sell
  whatYouSellIntro: entry(
    "Find the path that matches your business model and launch with the same 3% fee and 97% vendor payout.",
    (_p, f) =>
      `Find the path that matches your business model and launch with the same ${f}% fee, taken on what is left after card processing comes off the sale.`
  ),

  // ---- feature matrix (data/featureMatrix.ts)
  featureMatrixPayouts: entry(
    "Vendors connect payouts through onboarding and keep 97% of every sale.",
    (_p, f) => `Vendors connect payouts through onboarding and keep ${keep(f)} of every sale after card processing.`
  ),

  // ---- vendor-types
  vendorTypesKeepFeature: entry("Keep 97% of every sale", (_p, f) => `Keep ${keep(f)} of every sale after card processing`),
  /** The feature name beside `vendorTypesRevenueShare`. */
  vendorTypesRevenueShareName: entry("97% Revenue Share", (_p, f) => `${keep(f)} Revenue Share After Card Processing`),
  /** The label under the big "97%" badge in the vendor-types values grid. */
  vendorTypesToCreatorsLabel: entry("To Creators", () => "Of the Rest to Creators"),
  vendorTypesRevenueShare: entry(
    "Keep 97% of every sale, just 3% coalition fee",
    (_p, f) => `Keep ${keep(f)} of every sale after card processing, just ${f}% coalition fee`
  ),
  vendorTypesPricingTransparency: entry(
    "97% goes to creator, 3% to coalition - always",
    (_p, f) => `After card processing, ${keep(f)} goes to creator, ${f}% to coalition - always`
  ),
  vendorTypesToCreators: entry(
    "Ninety-seven cents of every dollar goes directly to the people who did the work.",
    (_p, f) =>
      `After card processing comes off, ${100 - f} cents of every remaining dollar goes directly to the people who did the work.`
  ),
  vendorTypesCoalitionFee: entry(
    "Just 3% covers everything: platform, payments, development, and community programs.",
    (_p, f) => `Just ${f}%, taken after card processing, covers the platform, development, and community programs.`
  ),
  vendorTypesHiddenFees: entry(
    "No required subscription, no listing fees, no payment processing fees. Optional paid plans lower the rate.",
    (p) =>
      `No required subscription and no listing fees. ${capitalise(cardProcessing(p))} comes off the sale first, in the open. Optional paid plans lower the rate.`
  ),

  // ---- sell (SellPageClient.tsx)
  sellBenefitTitle: entry("Keep at least 97% of Every Transaction", (_p, f) => `Keep at least ${keep(f)} After Card Processing`),
  sellBenefitBody: entry(
    "A 3% coalition fee on the free plan, and lower on a paid plan. No listing fees, and no payment processing fees passed to you — we absorb those.",
    (p, f) =>
      `${capitalise(cardProcessing(p))} comes off each sale first. Then a ${f}% coalition fee on the free plan, and lower on a paid plan, is taken on what is left. No listing fees.`
  ),
  sellMathFootnote: entry(
    "That's it. No payment processing fees, no hidden charges. Compare that to farmers markets (often 30-40% in fees and time) or grocery stores (where producers see only 10-20% of the retail price).",
    (p) =>
      `Card processing is an estimate (${processingEstimateText(p)}) taken off the sale first; there are no other hidden charges. Compare that to farmers markets (often 30-40% in fees and time) or grocery stores (where producers see only 10-20% of the retail price).`
  ),
  sellRadicalYouLabel: entry("Goes to You", () => "Of the Rest Goes to You"),
  sellRadicalYouBody: entry(
    "The producer. The person who did the actual work.",
    (p) => `After ${cardProcessing(p)} comes off the sale. The producer. The person who did the actual work.`
  ),
  sellRadicalCoalitionLabel: entry("Goes to the Coalition", () => "Of the Rest Goes to the Coalition"),
  sellRadicalFooter: entry(
    "That's the free plan. Paid plans are optional and lower the rate. No listing fees, and no payment processing fees passed to you. Unlike venture-backed platforms that burn cash to gain market share then raise fees, we're building something sustainable for our community.",
    (p) =>
      `That's the free plan, taken on what is left after ${cardProcessing(p)}. Paid plans are optional and lower the rate. No listing fees. Unlike venture-backed platforms that burn cash to gain market share then raise fees, we're building something sustainable for our community.`
  ),
  /** First sentence of the sell page's "How much does it cost to join?" answer. */
  sellCostLead: entry(
    "Nothing upfront. On the free plan it is 3% to the coalition when you make a sale, with no listing fees, no payment processing fees and no hidden charges — if you don't sell, you don't pay.",
    (p, f) =>
      `Nothing upfront. When you make a sale, ${cardProcessing(p)} comes off first and, on the free plan, ${f}% of what is left goes to the coalition — no listing fees and no hidden charges; if you don't sell, you don't pay.`
  ),

  // ---- creators
  creatorsMetaDescription: entry(
    "Storefronts, referrals, and audience tools that help makers and creators get discovered and paid — while keeping 97% of every sale.",
    (_p, f) =>
      `Storefronts, referrals, and audience tools that help makers and creators get discovered and paid — while keeping ${keep(f)} of every sale after card processing.`
  ),
  creatorsHero: entry(
    "Free Black Market gives makers and creators their own storefront, referral tools, and audience features — so you can grow a following and sell directly, while keeping 97% of every sale.",
    (_p, f) =>
      `Free Black Market gives makers and creators their own storefront, referral tools, and audience features — so you can grow a following and sell directly, while keeping ${keep(f)} of every sale after card processing.`
  ),
  creatorsKeepHeading: entry("Keep 97%", (_p, f) => `Keep ${keep(f)} after card processing`),
  creatorsKeepBody: entry(
    "A 3% coalition fee on the free plan — no listing fees, no required subscription, and no payment processing fees passed to you. Value stays with the people who create it.",
    (p, f) =>
      `${capitalise(cardProcessing(p))} comes off the sale first, then a ${f}% coalition fee on the free plan — no listing fees and no required subscription. Value stays with the people who create it.`
  ),

  // ---- how-it-works
  howItWorksBuyerTransparency: entry(
    "Every listing shows exactly where your money goes. 97% to the creator, 3% to the coalition. No hidden fees.",
    (_p, f) =>
      `Every listing shows exactly where your money goes. Card processing comes off first; of the rest, ${keep(f)} to the creator, ${f}% to the coalition. No hidden fees.`
  ),
  howItWorksGetPaid: entry(
    "Receive at least 97% of every sale. FBM collects the payment and pays you by ACH, weekly by default.",
    (_p, f) =>
      `Receive at least ${keep(f)} of every sale after card processing. FBM collects the payment and pays you by ACH, weekly by default.`
  ),
  /** The how-it-works fee card, up to the paid-rates clause. */
  howItWorksFeeLead: entry(
    "No required subscription. No listing fees. No payment processing fees passed to you. 3% when you make a sale on the free plan",
    (p, f) =>
      `No required subscription. No listing fees. ${capitalise(cardProcessing(p))} comes off each sale first, then ${f}% of what is left on the free plan`
  ),
  /** The headings beside how-it-works' big "97%" / "3%" badges. */
  howItWorksCreatorsLabel: entry("Goes to Creators", () => "Of the Rest Goes to Creators"),
  howItWorksCoalitionLabel: entry("Goes to the Coalition", () => "Of the Rest Goes to the Coalition"),
  howItWorksCreatorsCard: entry(
    "When you buy something on Free Black Market, 97 cents of every dollar goes directly to the person who made it. No corporate headquarters taking a cut. No shareholders to pay.",
    (_p, f) =>
      `When you buy something on Free Black Market, card processing comes off first and ${100 - f} cents of every remaining dollar goes directly to the person who made it. No corporate headquarters taking a cut. No shareholders to pay.`
  ),
  howItWorksCoalitionCard: entry(
    "Just 3% covers everything: platform operations, payment processing, development, and community support. No required subscription. No additional fees. That's the whole story.",
    (p, f) =>
      `${capitalise(cardProcessing(p))} comes off the sale first. Then just ${f}% covers platform operations, development, and community support. No required subscription. No other fees. That's the whole story.`
  ),
  howItWorksPaidFaq: entry(
    "By ACH. When you make a sale, at least 97% is credited to you and paid out to your bank account — weekly by default, with faster tiers available for a fee. No invoicing, no waiting for thresholds, no complicated processes.",
    (p, f) =>
      `By ACH. When you make a sale, ${cardProcessing(p)} comes off first and at least ${keep(f)} of the rest is credited to you and paid out to your bank account — weekly by default, with faster tiers available for a fee. No invoicing, no waiting for thresholds, no complicated processes.`
  ),
  howItWorksCoverFaq: entry(
    "Everything. Platform hosting, development, payment processing, customer support, and community programs. There are no hidden fees, no required subscription, no listing fees, and no payment processing fees passed to providers.",
    (p, f) =>
      `Platform hosting, development, customer support, and community programs. Card processing is not inside the ${f}%: the estimate (${processingEstimateText(p)}) comes off each sale first, and the ${f}% is taken on what is left. There are no hidden fees, no required subscription and no listing fees.`
  ),

  // ---- transparency
  transparencyShippingTaxLabel: entry("Fees on shipping or tax", () => "Commission on shipping or tax"),
  transparencyShippingTaxDetail: entry(
    "The commission is taken on the item, not on postage you have already paid for or tax you are only collecting.",
    () =>
      "The commission is taken on the item, not on postage or tax. Card processing is estimated on the whole charge, shipping and tax included, because that is what the card processor charges on."
  ),
  transparencyFeePaysForProcessing: entry(
    "Hosting, payments infrastructure, and the card processing we absorb rather than pass on",
    () => "Hosting and payments infrastructure (card processing itself comes off the sale before the fee, as an estimate)"
  ),
  transparencyCheckIt: entry(
    "The commission is booked as a ledger entry on every order and reversed on every refund. The code that does it is public.",
    () =>
      "The commission and the card-processing estimate are each booked as a ledger entry on every order. The commission is reversed on every refund; the processing is not, because the card processor keeps its fee, and it comes out of the vendor's share. The code that does it is public."
  ),

  // ---- ConversionCopy ProducerPriceExplanation
  producerPriceExplanationTail: entry(
    "coalition fee keeps the marketplace running — no listing, monthly, or payment processing fees passed to vendors.",
    (p) =>
      `coalition fee is taken after ${cardProcessing(p)} comes off the sale — no listing or monthly fees.`
  ),

  // ---- FeeBreakdown's own row
  feeBreakdownProcessingLine: entry(
    "No payment processing fees passed to you",
    (p) => `${capitalise(cardProcessing(p))} comes off the sale first`
  ),
} satisfies Record<string, CopyEntry>

export type ProcessingCopyKey = keyof typeof PROCESSING_COPY

/** The sentence for `key` under the model `p`: today's exactly, or the fee-first one. */
export function processingCopy(key: ProcessingCopyKey, p: ProcessingInfo, feePercent = 3): string {
  const e: CopyEntry = PROCESSING_COPY[key]
  return isFeeFirst(p) ? e.feeFirst(p, feePercent) : e.legacy
}

/**
 * The "Payment processing passed through to you" row of the transparency
 * page's never-charged list: shown only while it is true.
 */
export const TRANSPARENCY_PROCESSING_NEVER_CHARGED = {
  label: "Payment processing passed through to you",
  detail: "Card processing is absorbed in the coalition fee rather than added on top of it.",
} as const

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
