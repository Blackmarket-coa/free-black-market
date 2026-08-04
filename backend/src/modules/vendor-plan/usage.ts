import { isUnlimited, type PlanLimit, type VendorPlanLimits } from "./limits"
import {
  computeOverage,
  EMBED_REQUEST_BLOCK,
  EMBED_REQUEST_BLOCK_CENTS,
  type UsageMetric,
} from "./overage"

/**
 * How much of a plan's allowance a seller has consumed.
 *
 * The counterpart to `limits.ts`, which answers "what may they have". This
 * answers "how much of it is gone" — the half the vendor never saw. Phase 1
 * shipped hard caps that deny with a 402, but nothing told a seller they were
 * at 9 of 10 embed keys until the tenth create failed. A cap the vendor cannot
 * see coming reads as a bug rather than a plan boundary.
 *
 * Pure — no imports beyond the limit types, no I/O — so the arithmetic,
 * including the awkward cases, asserts without a container. The counting
 * itself lives in `shared/plan-usage.ts`, which has to reach four modules.
 */

/** Where a seller stands against one allowance. */
export type UsageLevel = "ok" | "approaching" | "at_limit"

/**
 * Fraction of an allowance at which the panel starts warning.
 *
 * 80% rather than something tighter: the point is to give a vendor time to
 * upgrade before a create fails, and on the free tier's small allowances
 * (1 embed key, 1 domain) anything higher would only ever fire at the moment
 * the cap is already reached, which is too late to be a warning.
 */
export const APPROACHING_RATIO = 0.8

export type ResourceUsage = {
  current: number
  limit: PlanLimit
  /** Headroom left. `null` when the allowance is unlimited. */
  remaining: number | null
  /** 0–100, rounded. `null` when unlimited — a share of infinity is meaningless. */
  percent_used: number | null
  level: UsageLevel
  unlimited: boolean
}

/**
 * Where one allowance stands.
 *
 * Three cases the obvious arithmetic gets wrong:
 *
 * - **Unlimited** (`null` limit) is not "very large": there is no percentage
 *   and no headroom figure to show, so both are `null` rather than a number
 *   the UI would have to special-case anyway.
 * - **A zero limit** is a real, very restrictive cap, not a missing one. It is
 *   `at_limit` immediately, and reporting 100% avoids a divide by zero.
 * - **Over the limit** happens for real: a downgrade lowers the ceiling under
 *   a seller who already holds more than the new plan allows. Nothing is
 *   confiscated — the enforcement points only block *new* creates — so this
 *   reports `at_limit` with `remaining: 0`, never negative headroom or a
 *   percentage above 100.
 */
export function resourceUsage(
  currentRaw: number,
  limit: PlanLimit
): ResourceUsage {
  const current = Math.max(0, Math.floor(currentRaw || 0))

  if (isUnlimited(limit)) {
    return {
      current,
      limit,
      remaining: null,
      percent_used: null,
      level: "ok",
      unlimited: true,
    }
  }

  const remaining = Math.max(0, limit - current)
  const percent_used =
    limit <= 0 ? 100 : Math.min(100, Math.round((current / limit) * 100))

  const level: UsageLevel =
    current >= limit
      ? "at_limit"
      : current >= limit * APPROACHING_RATIO
        ? "approaching"
        : "ok"

  return { current, limit, remaining, percent_used, level, unlimited: false }
}

/** The countable allowances — those with a "how many do you have" answer. */
export const COUNTABLE_LIMIT_KEYS = [
  "embed_keys",
  "connect_domains",
  "webhook_subscriptions",
  "vault_documents",
] as const

export type CountableLimitKey = (typeof COUNTABLE_LIMIT_KEYS)[number]

/** Vendor-facing names. The limit keys are internal vocabulary. */
export const COUNTABLE_LIMIT_LABELS: Record<CountableLimitKey, string> = {
  embed_keys: "Embed keys",
  connect_domains: "Connected domains",
  webhook_subscriptions: "Webhook endpoints",
  vault_documents: "Vault documents",
}

/**
 * Allowances that are a rate or a window rather than a running total.
 *
 * Deliberately reported separately: `embed_requests_per_minute` resets every
 * minute and `analytics_range_days` is a lookback window that is clamped, not
 * consumed. Showing either as "X of Y used" would invent a meter that does not
 * exist — and for the analytics range, imply a vendor could exhaust something
 * they simply cannot.
 */
export const ALLOWANCE_LIMIT_KEYS = [
  "embed_requests_per_minute",
  "analytics_range_days",
] as const

export type AllowanceLimitKey = (typeof ALLOWANCE_LIMIT_KEYS)[number]

export const ALLOWANCE_LIMIT_LABELS: Record<AllowanceLimitKey, string> = {
  embed_requests_per_minute: "Embed requests per minute",
  analytics_range_days: "Analytics history (days)",
}

/**
 * Where a seller stands against a *metered* allowance.
 *
 * Separate from `UsageLevel` on purpose. A capped resource has an `at_limit`
 * state because the cap is where things stop; a meter has no such point — going
 * past the included volume is a normal, permitted outcome that costs money
 * rather than failing. Calling that `at_limit` would tell a vendor their embeds
 * are about to break when what actually happens is a line on next month's bill.
 */
export type MeteredLevel = "ok" | "approaching" | "over"

/** Which plan allowance covers each metered metric. */
export const METERED_LIMIT_KEYS: Record<UsageMetric, keyof VendorPlanLimits> = {
  embed_requests: "included_embed_requests",
}

/** Vendor-facing names, same as the countable labels. */
export const METERED_METRIC_LABELS: Record<UsageMetric, string> = {
  embed_requests: "Embed API requests",
}

export type MeteredUsage = {
  metric: UsageMetric
  label: string
  /** Requests recorded so far in the open period. */
  recorded: number
  /** What the plan covers per period. `null` is unlimited — never billable. */
  included: PlanLimit
  unlimited: boolean
  /**
   * Share of the included volume consumed, rounded.
   *
   * **Not clamped to 100.** For a cap, above-100% would be a bug; for a meter it
   * is the number the vendor most needs — "163%" is what makes the projected
   * charge legible. `null` when unlimited, and also when the plan includes zero:
   * every request is billable there, and a percentage of nothing would be a
   * fabricated figure rather than a large one.
   */
  percent_used: number | null
  level: MeteredLevel
  /** Consumption beyond the allowance, before block rounding. */
  excess: number
  blocks: number
  /**
   * Cents this period would cost if it closed right now.
   *
   * Explicitly a projection: the meter is still open, and the close job bills
   * the *previous* month. Labelling it as settled would be the one lie this
   * screen must not tell — the mirror of the omit-rather-than-report-zero rule
   * on the countable side.
   */
  projected_amount_cents: number
  /** The pricing in force, so the panel can explain the projection. */
  block_size: number
  cents_per_block: number
  /** The open period, ISO, half-open `[start, end)`. */
  period_start: string
  period_end: string
}

/** One meter's raw reading, as gathered by the caller. */
export type MeterReading = {
  metric: UsageMetric
  recorded: number
  period_start: string
  period_end: string
}

/**
 * Turn a raw meter reading into what the vendor should see.
 *
 * The cost comes from `computeOverage` — **the same function the close job
 * bills with** — rather than a display-side re-derivation. That is the point of
 * routing through it: the projection a vendor reads is produced by the code
 * that charges them, so the two cannot drift into disagreement. The countable
 * side takes the same posture by mirroring each count against its enforcement
 * point; this is that rule applied to money.
 */
export function meteredUsage(
  reading: MeterReading,
  included: PlanLimit,
  pricing?: { blockSize?: number; centsPerBlock?: number }
): MeteredUsage {
  const overage = computeOverage({
    recorded: reading.recorded,
    included,
    blockSize: pricing?.blockSize,
    centsPerBlock: pricing?.centsPerBlock,
  })

  const unlimited = isUnlimited(included)
  const allowance = unlimited ? null : Math.max(0, included as number)

  const percent_used =
    allowance === null || allowance === 0
      ? null
      : Math.round((overage.recorded / allowance) * 100)

  const level: MeteredLevel = unlimited
    ? "ok"
    : overage.excess > 0
      ? "over"
      : allowance !== null &&
          allowance > 0 &&
          overage.recorded >= allowance * APPROACHING_RATIO
        ? "approaching"
        : "ok"

  return {
    metric: reading.metric,
    label: METERED_METRIC_LABELS[reading.metric],
    recorded: overage.recorded,
    included,
    unlimited,
    percent_used,
    level,
    excess: overage.excess,
    blocks: overage.blocks,
    projected_amount_cents: overage.amount_cents,
    block_size: pricing?.blockSize ?? EMBED_REQUEST_BLOCK,
    cents_per_block: pricing?.centsPerBlock ?? EMBED_REQUEST_BLOCK_CENTS,
    period_start: reading.period_start,
    period_end: reading.period_end,
  }
}

export type SellerUsageReport = {
  plan_code: string
  resources: (ResourceUsage & { key: CountableLimitKey; label: string })[]
  allowances: { key: AllowanceLimitKey; label: string; limit: number }[]
  /** Metered consumption for the open period, with its projected cost. */
  metered: MeteredUsage[]
  /** True when any countable resource is at its ceiling. */
  any_at_limit: boolean
  /** Total cents the open period would cost if it closed now. */
  projected_overage_cents: number
}

/**
 * Assemble the report from counts the caller has already gathered.
 *
 * Takes the counts rather than fetching them so this stays pure; the fetching
 * spans four modules and lives in `shared/plan-usage.ts`.
 *
 * A resource whose count is missing is **omitted, not reported as zero**. A
 * failed count is not evidence of no usage, and "0 of 1 used" would tell a
 * vendor they have headroom they may not have — the one lie this screen must
 * not tell. Absence is honest; the panel simply shows one fewer row.
 *
 * Meters follow the same rule, with one difference the caller has to respect:
 * a meter with *no stored row* genuinely has zero usage — the row is only
 * written on the first request — so that case is a real reading of `0`, while
 * a read that *failed* must be left out of `meters` entirely.
 */
export function buildUsageReport(
  planCode: string,
  limits: VendorPlanLimits,
  counts: Partial<Record<CountableLimitKey, number>>,
  meters: readonly MeterReading[] = []
): SellerUsageReport {
  const resources = COUNTABLE_LIMIT_KEYS.filter(
    (key) => typeof counts[key] === "number"
  ).map((key) => ({
    key,
    label: COUNTABLE_LIMIT_LABELS[key],
    ...resourceUsage(counts[key] as number, limits[key]),
  }))

  const metered = meters.map((reading) =>
    meteredUsage(reading, limits[METERED_LIMIT_KEYS[reading.metric]] as PlanLimit)
  )

  return {
    plan_code: planCode,
    resources,
    allowances: ALLOWANCE_LIMIT_KEYS.map((key) => ({
      key,
      label: ALLOWANCE_LIMIT_LABELS[key],
      limit: limits[key],
    })),
    metered,
    any_at_limit: resources.some((r) => r.level === "at_limit"),
    projected_overage_cents: metered.reduce(
      (sum, m) => sum + m.projected_amount_cents,
      0
    ),
  }
}
