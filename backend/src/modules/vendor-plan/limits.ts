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
  /**
   * Embed API requests included per calendar month.
   *
   * The metered allowance, and deliberately distinct from
   * `embed_requests_per_minute` above: that one is a burst ceiling protecting
   * infrastructure and stays hard, this one is monthly volume that bills as
   * overage past the included figure (`vendor-plan/overage.ts`). A vendor can
   * buy more volume; they cannot buy a higher instantaneous rate, because what
   * the rate bounds is load rather than value.
   *
   * `null` means unlimited and is never billable.
   */
  included_embed_requests: PlanLimit
  /**
   * Grower KARMA tier this plan floors the seller to, regardless of earned
   * karma — the "bought" half of the earned-vs-bought progression duality
   * (`modules/progression/grower-karma.ts`, `effectiveGrowerTier`). `null` means
   * the plan makes no tier claim and the grower keeps whatever tier their
   * activity earned. A floor only ever raises a tier, never lowers it: a grower
   * who earned a higher tier keeps it even on a plan that floors lower.
   *
   * Typed as a plain string to keep this table import-free (it must not depend
   * on the progression module); a drift test asserts every non-null value is a
   * real `GrowerTierName`.
   */
  grower_tier_floor: string | null
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
  // Enough to run a small embedded storefront without ever seeing a bill;
  // past it the free tier meters like any other.
  included_embed_requests: 50_000,
  // Free growers earn their tier entirely through activity.
  grower_tier_floor: null,
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
    included_embed_requests: 250_000,
    // Storefront/vault plan, not a grower-progression plan: no tier claim.
    grower_tier_floor: null,
  },
  pro: {
    embed_requests_per_minute: 300,
    analytics_range_days: 90,
    embed_keys: 10,
    connect_domains: 25,
    webhook_subscriptions: 10,
    vault_documents: 500,
    included_embed_requests: 1_000_000,
    grower_tier_floor: "Root",
  },
  scale: {
    embed_requests_per_minute: 1_000,
    analytics_range_days: 365,
    embed_keys: 50,
    connect_domains: 100,
    webhook_subscriptions: 50,
    vault_documents: 5_000,
    included_embed_requests: 5_000_000,
    grower_tier_floor: "Canopy",
  },
  internal: {
    embed_requests_per_minute: 1_000,
    analytics_range_days: 365,
    embed_keys: null,
    connect_domains: null,
    webhook_subscriptions: null,
    vault_documents: null,
    // Operator plan: unlimited volume, so overage is never billable.
    included_embed_requests: null,
    // Operator-assigned. Left earning like anyone so assigning it never
    // silently shifts the grower/hub inter-node split for FBM's own vendors.
    grower_tier_floor: null,
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
