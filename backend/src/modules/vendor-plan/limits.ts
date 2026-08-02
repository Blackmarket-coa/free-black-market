/**
 * Quantitative plan limits — the counterpart to `catalog.ts`.
 *
 * `catalog.ts` answers "may this seller reach this surface at all" (a boolean,
 * enforced by `requirePlanFeature`). This file answers "how much of it may they
 * have" for the surfaces that were already counting something but were counting
 * it against a module constant instead of against the seller's plan.
 *
 * Kept separate from `VendorPlanDefinition` on purpose: a limit table changes on
 * a different cadence from the priced ladder, and every consumer of a limit
 * wants the whole resolved set, not one field off a plan row. Pure — no imports,
 * no I/O — so the numbers can be asserted directly in unit tests.
 */

/** `null` means unlimited. Never `0`, which is a real (and very restrictive) cap. */
export type PlanLimit = number | null

export type VendorPlanLimits = {
  /**
   * Embed API calls per minute per publishable key (`/store/embed/*`).
   *
   * This is the vendor-facing meter: it scales with how much traffic a vendor's
   * own site is allowed to drive through FBM. The per-IP limiter alongside it is
   * a fixed abuse backstop and deliberately does NOT scale — it caps a single
   * misbehaving client, which is not something a vendor buys more of.
   */
  embed_requests_per_minute: number
  /** How far back `GET /vendor/analytics/embed?range=` may look. */
  analytics_range_days: number
  /** Live (non-revoked) publishable keys a seller may hold. */
  embed_keys: PlanLimit
  /** Hostnames in the `connect_domains` allow-list. */
  connect_domains: PlanLimit
  /** Active webhook subscription endpoints. */
  webhook_subscriptions: PlanLimit
  /** Documents in the vendor's document vault. */
  vault_documents: PlanLimit
}

/**
 * Limits for a seller whose plan is unknown or has been removed from the
 * catalog. Matches `free` — the same fail-closed posture `featureKeysForPlan`
 * takes, so a typo cannot silently hand out a higher ceiling.
 */
const FREE_LIMITS: VendorPlanLimits = {
  embed_requests_per_minute: 60,
  analytics_range_days: 7,
  embed_keys: 1,
  connect_domains: 1,
  webhook_subscriptions: 1,
  vault_documents: 5,
}

const PLAN_LIMITS: Record<string, VendorPlanLimits> = {
  free: FREE_LIMITS,
  starter: {
    embed_requests_per_minute: 120,
    analytics_range_days: 30,
    embed_keys: 3,
    connect_domains: 5,
    webhook_subscriptions: 3,
    vault_documents: 50,
  },
  pro: {
    embed_requests_per_minute: 300,
    analytics_range_days: 90,
    embed_keys: 10,
    connect_domains: 25,
    webhook_subscriptions: 10,
    vault_documents: 500,
  },
  scale: {
    embed_requests_per_minute: 1_000,
    analytics_range_days: 365,
    embed_keys: 50,
    connect_domains: 100,
    webhook_subscriptions: 50,
    vault_documents: 5_000,
  },
  internal: {
    embed_requests_per_minute: 1_000,
    analytics_range_days: 365,
    embed_keys: null,
    connect_domains: null,
    webhook_subscriptions: null,
    vault_documents: null,
  },
}

/**
 * The limits a plan grants. An unknown code gets the free tier's limits rather
 * than throwing: a limit lookup happens on request paths that must not 500
 * because a plan row drifted.
 */
export function limitsForPlan(code: string | null | undefined): VendorPlanLimits {
  return (code && PLAN_LIMITS[code]) || FREE_LIMITS
}

/** Plan codes carrying an explicit limit set. Used by drift tests. */
export function plansWithLimits(): string[] {
  return Object.keys(PLAN_LIMITS)
}

export function isUnlimited(limit: PlanLimit): limit is null {
  return limit === null
}

/**
 * May a seller currently holding `current` of something add `adding` more?
 *
 * Expressed as "room for" rather than "at limit" so callers read as the
 * question they are actually asking at a create endpoint.
 */
export function hasRoomFor(
  current: number,
  limit: PlanLimit,
  adding = 1
): boolean {
  if (isUnlimited(limit)) return true
  return current + adding <= limit
}

/**
 * Clamp a requested quantity to what the plan allows.
 *
 * Used where exceeding the limit is not an error but a narrower answer — an
 * analytics range, for instance, where 402-ing a dashboard read would be worse
 * for the vendor than silently showing the window they pay for.
 */
export function clampToLimit(requested: number, limit: PlanLimit): number {
  if (isUnlimited(limit)) return requested
  return Math.min(requested, limit)
}
