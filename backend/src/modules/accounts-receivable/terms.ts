/**
 * Net-terms policy and AR arithmetic.
 *
 * Pure, container-free, integer-only. Everything here is asserted to the cent
 * in `__tests__/terms.unit.spec.ts` without a Medusa container, following the
 * `ccr-checkout.ts` precedent: money arithmetic that a test can pin exactly is
 * money arithmetic that cannot drift into a rounding defect.
 *
 * **This module never computes commission.** An invoice states what a buyer
 * owes; the platform's 3% is computed downstream by `payout-breakdown` from
 * the order, at `payout_config.platform_fee_percent`. Extending terms to a
 * buyer changes when the platform is paid, never how much — a tier that
 * discounts the buyer reduces the base that the same 3% applies to, and that
 * is the only interaction between the two. `assertNoCommissionEffect` exists
 * so that invariant has a caller and a test rather than only a comment.
 */

/** Stored lifecycle. `overdue` and `partially_paid` are DERIVED — see below. */
export enum InvoiceStatus {
  DRAFT = "draft",
  ISSUED = "issued",
  PAID = "paid",
  VOID = "void",
  WRITTEN_OFF = "written_off",
}

/**
 * What a reader should see. Wider than what is stored, deliberately:
 * `overdue` and `partially_paid` are functions of (due date, payments, now),
 * so storing them would create a second source of truth that a missed sweep
 * silently falsifies. An invoice is overdue because the date passed, not
 * because a cron job got round to saying so.
 */
export type PresentationStatus =
  | InvoiceStatus
  | "partially_paid"
  | "overdue"

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus"

export const AGING_BUCKETS: readonly AgingBucket[] = [
  "current",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_plus",
] as const

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Terms the platform will accept on a tier. Net-0 means due on receipt. */
export const MAX_TERMS_DAYS = 180

export class InvalidTermsError extends Error {}

/**
 * Net-N: the invoice is due N days after it is issued.
 *
 * Day granularity, computed on the UTC calendar day rather than by adding
 * milliseconds, so an invoice issued at 23:00 and one issued at 01:00 the same
 * day are due on the same date. Time-of-day on the due date is end-of-day UTC:
 * an invoice is not late until the day it is due has ended.
 */
export function deriveDueDate(issuedAt: Date, termsDays: number): Date {
  if (!Number.isInteger(termsDays) || termsDays < 0) {
    throw new InvalidTermsError(
      `payment terms must be a non-negative whole number of days, got ${termsDays}`
    )
  }
  if (termsDays > MAX_TERMS_DAYS) {
    throw new InvalidTermsError(
      `payment terms of ${termsDays} days exceed the ${MAX_TERMS_DAYS}-day maximum`
    )
  }
  const due = new Date(
    Date.UTC(
      issuedAt.getUTCFullYear(),
      issuedAt.getUTCMonth(),
      issuedAt.getUTCDate() + termsDays,
      23,
      59,
      59,
      999
    )
  )
  return due
}

export type TermsBearingTier = {
  id: string
  active?: boolean
  payment_terms_days?: number | null
  credit_limit_cents?: number | null
  customer_ids?: unknown
}

const tierIncludes = (tier: TermsBearingTier, customerId: string): boolean => {
  const ids = tier.customer_ids
  return Array.isArray(ids) && ids.includes(customerId)
}

/**
 * The terms a given buyer actually gets from a given vendor.
 *
 * A buyer can sit in more than one of a vendor's tiers (a co-op member who is
 * also approved for wholesale). We take the **most favourable** terms rather
 * than the first match or a priority order: the buyer was granted every tier
 * they are in, and honouring the weakest grant would make adding a tier
 * silently take something away.
 *
 * Returns 0 — due on receipt — when no tier applies. That is the correct
 * default for an ordinary retail order and is what the platform did before
 * this module existed.
 */
export function resolveTermsDays(
  tiers: readonly TermsBearingTier[],
  customerId: string
): number {
  let best = 0
  for (const tier of tiers) {
    if (tier.active === false) continue
    if (!tierIncludes(tier, customerId)) continue
    const days = Number(tier.payment_terms_days ?? 0)
    if (!Number.isFinite(days) || days <= 0) continue
    if (days > best) best = Math.floor(days)
  }
  return Math.min(best, MAX_TERMS_DAYS)
}

/**
 * The credit ceiling a buyer has with a vendor, in cents.
 *
 * Same multi-tier rule as terms, for the same reason. `null` means no ceiling
 * was ever set, which is distinct from a ceiling of zero: null is "this vendor
 * does not run credit limits", zero is "this buyer may not carry a balance".
 */
export function resolveCreditLimitCents(
  tiers: readonly TermsBearingTier[],
  customerId: string
): number | null {
  let best: number | null = null
  for (const tier of tiers) {
    if (tier.active === false) continue
    if (!tierIncludes(tier, customerId)) continue
    const raw = tier.credit_limit_cents
    if (raw === null || raw === undefined) continue
    const limit = Number(raw)
    if (!Number.isFinite(limit) || limit < 0) continue
    const floored = Math.floor(limit)
    if (best === null || floored > best) best = floored
  }
  return best
}

export type OutstandingInvoice = {
  status: InvoiceStatus | string
  total: number
  amount_paid: number
  due_at?: Date | string | null
}

/** What is still owed on one invoice. Never negative — an overpayment is 0. */
export function outstandingCents(invoice: OutstandingInvoice): number {
  if (
    invoice.status === InvoiceStatus.VOID ||
    invoice.status === InvoiceStatus.WRITTEN_OFF ||
    invoice.status === InvoiceStatus.DRAFT
  ) {
    return 0
  }
  const total = Math.floor(Number(invoice.total) || 0)
  const paid = Math.floor(Number(invoice.amount_paid) || 0)
  return Math.max(0, total - paid)
}

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days the invoice is past due. 0 when not yet due or not owed. */
export function daysPastDue(invoice: OutstandingInvoice, now: Date): number {
  if (outstandingCents(invoice) <= 0) return 0
  const due = asDate(invoice.due_at)
  if (!due) return 0
  const diff = now.getTime() - due.getTime()
  if (diff <= 0) return 0
  return Math.floor(diff / MS_PER_DAY)
}

export function isOverdue(invoice: OutstandingInvoice, now: Date): boolean {
  const due = asDate(invoice.due_at)
  if (!due) return false
  return outstandingCents(invoice) > 0 && now.getTime() > due.getTime()
}

/**
 * How a reader should see this invoice right now.
 *
 * Order matters: a terminal stored status always wins over a derived one, so a
 * voided invoice never presents as overdue no matter how old it is.
 */
export function presentationStatus(
  invoice: OutstandingInvoice,
  now: Date
): PresentationStatus {
  const stored = invoice.status as InvoiceStatus
  if (
    stored === InvoiceStatus.DRAFT ||
    stored === InvoiceStatus.VOID ||
    stored === InvoiceStatus.WRITTEN_OFF ||
    stored === InvoiceStatus.PAID
  ) {
    return stored
  }
  if (isOverdue(invoice, now)) return "overdue"
  if (Math.floor(Number(invoice.amount_paid) || 0) > 0) return "partially_paid"
  return InvoiceStatus.ISSUED
}

export function bucketForDaysPastDue(days: number): AgingBucket {
  if (days <= 0) return "current"
  if (days <= 30) return "d1_30"
  if (days <= 60) return "d31_60"
  if (days <= 90) return "d61_90"
  return "d90_plus"
}

export type AgingSummary = {
  buckets: Record<AgingBucket, number>
  total_outstanding: number
  invoice_count: number
}

/**
 * Standard AR aging. Buckets hold outstanding cents, not invoice totals — a
 * half-paid invoice ages only for what is still owed.
 */
export function summarizeAging(
  invoices: readonly OutstandingInvoice[],
  now: Date
): AgingSummary {
  const buckets = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
  } as Record<AgingBucket, number>

  let total = 0
  let count = 0

  for (const invoice of invoices) {
    const outstanding = outstandingCents(invoice)
    if (outstanding <= 0) continue
    buckets[bucketForDaysPastDue(daysPastDue(invoice, now))] += outstanding
    total += outstanding
    count += 1
  }

  return { buckets, total_outstanding: total, invoice_count: count }
}

/** Everything a buyer currently owes a vendor across all open invoices. */
export function creditExposureCents(
  invoices: readonly OutstandingInvoice[]
): number {
  let sum = 0
  for (const invoice of invoices) sum += outstandingCents(invoice)
  return sum
}

export type CreditDecision = {
  allowed: boolean
  limit_cents: number | null
  exposure_cents: number
  available_cents: number | null
  reason: "no_limit" | "within_limit" | "would_exceed_limit" | "past_due"
}

/**
 * May this buyer take on `chargeCents` more of this vendor's credit?
 *
 * Two independent refusals, and the past-due one comes first on purpose: a
 * buyer sitting on a late invoice is refused more credit even when they are
 * nominally under their ceiling, because the ceiling was extended against a
 * promise the buyer is currently not keeping.
 */
export function evaluateCreditLimit(args: {
  limitCents: number | null
  invoices: readonly OutstandingInvoice[]
  chargeCents: number
  now: Date
  blockWhenPastDue?: boolean
}): CreditDecision {
  const exposure = creditExposureCents(args.invoices)
  const charge = Math.max(0, Math.floor(args.chargeCents))

  if (args.blockWhenPastDue !== false) {
    const anyPastDue = args.invoices.some((i) => isOverdue(i, args.now))
    if (anyPastDue) {
      return {
        allowed: false,
        limit_cents: args.limitCents,
        exposure_cents: exposure,
        available_cents:
          args.limitCents === null
            ? null
            : Math.max(0, args.limitCents - exposure),
        reason: "past_due",
      }
    }
  }

  if (args.limitCents === null) {
    return {
      allowed: true,
      limit_cents: null,
      exposure_cents: exposure,
      available_cents: null,
      reason: "no_limit",
    }
  }

  const available = Math.max(0, args.limitCents - exposure)
  const allowed = exposure + charge <= args.limitCents

  return {
    allowed,
    limit_cents: args.limitCents,
    exposure_cents: exposure,
    available_cents: available,
    reason: allowed ? "within_limit" : "would_exceed_limit",
  }
}

/**
 * Dunning ladder, in days past due. A reminder fires the day it is reached and
 * never again — `dunningStageFor` returns the stage only on an exact hit, so a
 * daily sweep sends at most one reminder per invoice per stage without needing
 * to remember what it already sent.
 */
export const DUNNING_STAGES = [1, 7, 14, 30, 60] as const
export type DunningStage = (typeof DUNNING_STAGES)[number]

export function dunningStageFor(
  invoice: OutstandingInvoice,
  now: Date
): DunningStage | null {
  const days = daysPastDue(invoice, now)
  const hit = DUNNING_STAGES.find((stage) => stage === days)
  return hit ?? null
}

/**
 * The 3% invariant, with a caller.
 *
 * Net terms move *when* money arrives. If a caller ever tries to make the
 * platform fee a function of terms, tier, or lateness, this throws. The
 * platform fee is `payout_config.platform_fee_percent` applied to the order,
 * and `docs/ADDON_COMMITMENTS.md` §3 commits that it never creeps upward.
 */
export function assertNoCommissionEffect(args: {
  platformFeePercentBefore: number
  platformFeePercentAfter: number
}): void {
  if (args.platformFeePercentBefore !== args.platformFeePercentAfter) {
    throw new Error(
      "accounts-receivable must not change the platform fee: " +
        `${args.platformFeePercentBefore}% -> ${args.platformFeePercentAfter}%. ` +
        "Terms change when the platform is paid, never how much."
    )
  }
}
