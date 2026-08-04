import { isUnlimited, type PlanLimit } from "./limits"

/**
 * Metered overage — what a seller owes for consumption beyond their plan's
 * included volume.
 *
 * The counterpart to the hard caps. A cap answers "may you hold another one"
 * and denies; a meter answers "how much did you use" and bills. The two are
 * deliberately different mechanisms applied to different kinds of resource:
 *
 * - **Stock** (embed keys, domains, webhook endpoints, vault documents) stays
 *   capped. These are entitlements you hold, not volume you consume; letting a
 *   seller silently accumulate billable keys would turn a forgotten resource
 *   into a recurring charge nobody decided to incur.
 * - **Flow** (embed API requests) is metered. Volume is the thing a vendor
 *   actually buys more of as their own site grows, and denying it mid-month
 *   breaks their storefront rather than their budget.
 *
 * The per-minute rate limiter is unaffected and stays hard. It is a burst
 * ceiling protecting infrastructure, not a billing boundary — a vendor cannot
 * buy their way past it, because what it bounds is instantaneous load rather
 * than monthly value.
 *
 * Pure — no imports beyond the limit types, no I/O — so the money arithmetic
 * asserts without a database.
 */

/** Metered metrics. Stock resources are capped, not metered, and are absent. */
export const USAGE_METRICS = ["embed_requests"] as const
export type UsageMetric = (typeof USAGE_METRICS)[number]

export function isUsageMetric(value: unknown): value is UsageMetric {
  return (
    typeof value === "string" && (USAGE_METRICS as readonly string[]).includes(value)
  )
}

/**
 * Overage is priced per block, not per request.
 *
 * Per-request pricing at any believable rate produces sub-cent amounts that
 * round to zero or to noise; a block is the smallest unit that survives
 * integer-cent arithmetic honestly.
 */
export const EMBED_REQUEST_BLOCK = 1_000

/**
 * Cents per block of embed requests beyond the plan's included volume.
 *
 * A pricing decision, isolated here as a single constant so changing it is one
 * edit and one test update rather than a hunt. Deliberately modest: overage
 * exists to stop heavy use being free, not to punish growth — a vendor whose
 * traffic doubles should see a bill that reads as usage, not as a penalty that
 * makes them leave.
 */
export const EMBED_REQUEST_BLOCK_CENTS = 25

export type OverageResult = {
  /** Recorded consumption for the period, clamped to a sane integer. */
  recorded: number
  /** What the plan covers. `null` means unlimited — never billable. */
  included: PlanLimit
  /** Consumption beyond the allowance, before block rounding. */
  excess: number
  /** Whole blocks billed (rounded UP — a started block is a paid block). */
  blocks: number
  amount_cents: number
  /** False when there is nothing to charge, so callers can skip cleanly. */
  billable: boolean
}

const NOT_BILLABLE = (recorded: number, included: PlanLimit): OverageResult => ({
  recorded,
  included,
  excess: 0,
  blocks: 0,
  amount_cents: 0,
  billable: false,
})

/**
 * What a period's recorded usage costs beyond the included allowance.
 *
 * Rounds blocks **up**: a seller 1 request into a block pays for that block.
 * Rounding down would make the last partial block free for everyone, which at
 * scale is a systematic giveaway; rounding to nearest would make the charge
 * non-monotonic in a way no vendor could reconcile against their own logs.
 *
 * An unlimited allowance is never billable — that is the whole meaning of
 * `null` here, and the operator plan depends on it.
 */
export function computeOverage(input: {
  recorded: number
  included: PlanLimit
  blockSize?: number
  centsPerBlock?: number
}): OverageResult {
  const recorded = Math.max(0, Math.floor(input.recorded || 0))
  const included = input.included

  if (isUnlimited(included)) return NOT_BILLABLE(recorded, included)

  // A zero allowance is a real allowance: every request is billable. Guarding
  // only against negatives keeps that case meaningful.
  const allowance = Math.max(0, included)
  const excess = recorded - allowance
  if (excess <= 0) return NOT_BILLABLE(recorded, included)

  const blockSize = Math.max(1, Math.floor(input.blockSize ?? EMBED_REQUEST_BLOCK))
  const centsPerBlock = Math.max(
    0,
    Math.floor(input.centsPerBlock ?? EMBED_REQUEST_BLOCK_CENTS)
  )

  const blocks = Math.ceil(excess / blockSize)
  const amount_cents = blocks * centsPerBlock

  // A configured price of zero means "meter it but do not charge" — a real
  // operator state (measuring before switching billing on), and one that must
  // not produce a zero-amount charge row.
  if (amount_cents <= 0) {
    return { recorded, included, excess, blocks, amount_cents: 0, billable: false }
  }

  return { recorded, included, excess, blocks, amount_cents, billable: true }
}

/**
 * The calendar month a moment falls in, as a UTC half-open range.
 *
 * Billing periods are calendar months in UTC rather than per-seller
 * anniversaries: the meter is written on every request, so its period key has
 * to be derivable from a timestamp alone, without reading the seller's plan
 * assignment on the hot path.
 */
export function usagePeriodFor(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  )
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  )
  return { start, end }
}

/** The period immediately before the one containing `now`. What a close bills. */
export function previousUsagePeriod(now: Date): { start: Date; end: Date } {
  const { start } = usagePeriodFor(now)
  const prevStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1, 0, 0, 0, 0)
  )
  return { start: prevStart, end: start }
}

/** Stable period key for idempotency and lookup: `YYYY-MM`. */
export function usagePeriodKey(periodStart: Date): string {
  const y = periodStart.getUTCFullYear()
  const m = String(periodStart.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}
