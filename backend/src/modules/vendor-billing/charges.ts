/**
 * What the platform charges a vendor, and how a charge moves.
 *
 * Pure — no container, no I/O — following `vendor-plan/transitions.ts` and
 * `payout-breakdown/fee-resolution.ts`, so the state machine and the money
 * arithmetic can be asserted without a database or Stripe.
 *
 * This is the **platform → vendor** direction and is unrelated to
 * `api/vendor/invoices`, which is a vendor issuing invoices to their own
 * customers. Nothing in this codebase billed a vendor for anything before
 * this; plan subscriptions and promoted listings both had prices with no way
 * to collect them.
 */

export enum VendorChargeKind {
  /** A plan's recurring subscription fee. */
  PLAN = "plan",
  /** A promoted-listing purchase. */
  PROMOTION = "promotion",
  /** Metered overage aggregated from the Phase 1 counters. */
  USAGE = "usage",
  /** Anything an operator raises by hand. */
  MANUAL = "manual",
}

export enum VendorChargeStatus {
  /** Recorded, not yet presented to a payment method. */
  PENDING = "pending",
  /** Handed to Stripe; awaiting confirmation. ACH settles in days, not ms. */
  PROCESSING = "processing",
  PAID = "paid",
  FAILED = "failed",
  /** Cancelled before collection. Terminal, and never collectable. */
  VOID = "void",
  REFUNDED = "refunded",
}

/**
 * Legal status moves.
 *
 * `PAID -> REFUNDED` is the only way out of a terminal-looking state, and it
 * exists because a refund is a real event that must be representable without
 * rewriting history. `VOID` and `REFUNDED` are genuinely final: re-opening
 * either would let a charge be collected twice.
 *
 * `FAILED -> PROCESSING` is what a retry looks like — a failed card is not a
 * dead charge, and forcing a new row for each attempt would make "how much
 * does this vendor owe" a query over attempt history rather than a sum.
 */
const TRANSITIONS: Record<VendorChargeStatus, VendorChargeStatus[]> = {
  [VendorChargeStatus.PENDING]: [
    VendorChargeStatus.PROCESSING,
    VendorChargeStatus.PAID,
    VendorChargeStatus.FAILED,
    VendorChargeStatus.VOID,
  ],
  [VendorChargeStatus.PROCESSING]: [
    VendorChargeStatus.PAID,
    VendorChargeStatus.FAILED,
  ],
  [VendorChargeStatus.FAILED]: [
    VendorChargeStatus.PROCESSING,
    VendorChargeStatus.PAID,
    VendorChargeStatus.VOID,
  ],
  [VendorChargeStatus.PAID]: [VendorChargeStatus.REFUNDED],
  [VendorChargeStatus.VOID]: [],
  [VendorChargeStatus.REFUNDED]: [],
}

export function canTransition(
  from: VendorChargeStatus,
  to: VendorChargeStatus
): boolean {
  // A no-op move is always allowed: webhook replays re-assert a status the
  // charge already has, and that must not be an error.
  if (from === to) return true
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** Statuses from which no further collection will ever happen. */
export function isTerminal(status: VendorChargeStatus): boolean {
  return TRANSITIONS[status].length === 0
}

/** Does this charge still represent money the vendor owes? */
export function isOutstanding(status: VendorChargeStatus): boolean {
  return (
    status === VendorChargeStatus.PENDING ||
    status === VendorChargeStatus.PROCESSING ||
    status === VendorChargeStatus.FAILED
  )
}

export type ChargeLike = {
  amount: number
  currency_code: string
  status: VendorChargeStatus | string
}

/**
 * Sum what a vendor owes, in minor units.
 *
 * Throws on a mixed-currency set rather than adding cents to pence. A vendor
 * billed in two currencies needs two balances, and silently summing them would
 * produce a number that is wrong in both.
 */
export function outstandingBalance(charges: ChargeLike[]): {
  amount: number
  currency_code: string | null
} {
  const owed = charges.filter((c) =>
    isOutstanding(c.status as VendorChargeStatus)
  )
  if (owed.length === 0) return { amount: 0, currency_code: null }

  const currencies = new Set(owed.map((c) => c.currency_code.toLowerCase()))
  if (currencies.size > 1) {
    throw new Error(
      `Cannot total charges across currencies: ${[...currencies].sort().join(", ")}`
    )
  }

  return {
    amount: owed.reduce((sum, c) => sum + Math.round(c.amount), 0),
    currency_code: [...currencies][0],
  }
}

/**
 * Prorate a plan's price across the part of a period actually used.
 *
 * Mid-period upgrades are charged for the remainder, not the whole period —
 * billing a full month for four days is the kind of thing that produces
 * chargebacks. Rounded to the nearest minor unit, floored at zero, and capped
 * at the full price so a clock skew cannot bill more than the plan costs.
 */
export function proratedAmount(input: {
  fullAmount: number
  periodStart: Date
  periodEnd: Date
  from: Date
}): number {
  const total = input.periodEnd.getTime() - input.periodStart.getTime()
  if (total <= 0) return 0

  const remaining = input.periodEnd.getTime() - input.from.getTime()
  if (remaining <= 0) return 0

  const ratio = Math.min(1, remaining / total)
  return Math.max(0, Math.min(input.fullAmount, Math.round(input.fullAmount * ratio)))
}

/**
 * Stable idempotency key for a charge.
 *
 * Every charge path must supply one, and the unique index on the column is
 * what makes a replayed webhook or a re-fired cron a no-op instead of a second
 * debit. Composed rather than random so the *same logical charge* derives the
 * same key from either side of a retry.
 */
export function chargeIdempotencyKey(parts: {
  kind: VendorChargeKind
  sellerId: string
  /** Period, plan code, promotion tier — whatever makes this charge unique. */
  discriminator: string
}): string {
  return `${parts.kind}:${parts.sellerId}:${parts.discriminator}`
}
