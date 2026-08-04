import { isUnlimited, type PlanLimit, type VendorPlanLimits } from "./limits"

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
  "vault_storage_bytes",
] as const

export type CountableLimitKey = (typeof COUNTABLE_LIMIT_KEYS)[number]

/** Vendor-facing names. The limit keys are internal vocabulary. */
export const COUNTABLE_LIMIT_LABELS: Record<CountableLimitKey, string> = {
  embed_keys: "Embed keys",
  connect_domains: "Connected domains",
  webhook_subscriptions: "Webhook endpoints",
  vault_documents: "Vault documents",
  vault_storage_bytes: "Vault storage",
}

/**
 * Resources whose numbers are byte counts rather than item counts.
 *
 * Reported so the panel can render "1.2 GB of 10.0 GB" instead of the raw
 * figures. The arithmetic is identical — a byte quota is consumed exactly like
 * a document quota — so the only difference is the unit, and pretending
 * otherwise would mean a second parallel code path for no gain.
 */
export const BYTE_LIMIT_KEYS: readonly CountableLimitKey[] = [
  "vault_storage_bytes",
] as const

export function isByteLimitKey(key: string): boolean {
  return (BYTE_LIMIT_KEYS as readonly string[]).includes(key)
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

export type SellerUsageReport = {
  plan_code: string
  resources: (ResourceUsage & {
    key: CountableLimitKey
    label: string
    /** Render the numbers as sizes rather than as a count. */
    is_bytes: boolean
  })[]
  allowances: { key: AllowanceLimitKey; label: string; limit: number }[]
  /** True when any countable resource is at its ceiling. */
  any_at_limit: boolean
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
 */
export function buildUsageReport(
  planCode: string,
  limits: VendorPlanLimits,
  counts: Partial<Record<CountableLimitKey, number>>
): SellerUsageReport {
  const resources = COUNTABLE_LIMIT_KEYS.filter(
    (key) => typeof counts[key] === "number"
  ).map((key) => ({
    key,
    label: COUNTABLE_LIMIT_LABELS[key],
    is_bytes: isByteLimitKey(key),
    ...resourceUsage(counts[key] as number, limits[key]),
  }))

  return {
    plan_code: planCode,
    resources,
    allowances: ALLOWANCE_LIMIT_KEYS.map((key) => ({
      key,
      label: ALLOWANCE_LIMIT_LABELS[key],
      limit: limits[key],
    })),
    any_at_limit: resources.some((r) => r.level === "at_limit"),
  }
}
