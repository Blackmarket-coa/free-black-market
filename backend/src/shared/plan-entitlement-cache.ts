/**
 * Process-local cache of the feature keys a seller currently holds.
 *
 * The plan gate runs on every request to a gated `/vendor/*` prefix, so it
 * cannot afford a database round trip per request. This keeps a small
 * in-process map with a short TTL.
 *
 * **Deliberately not Redis.** `shared/cache.ts` is async, adds a network hop
 * per request, and no-ops entirely when `REDIS_URL` is unset — so it would cost
 * a round trip to buy very little over a 30-second TTL. The consequence is
 * bounded staleness across instances: an upgrade can take up to the TTL to
 * light up, and a revoked feature can stay reachable for up to the TTL. Both
 * are acceptable here — upgrades invalidate locally and synchronously on the
 * instance that served them, and downgrades are deferred to period end anyway,
 * so nothing is withdrawn abruptly. Redis pub/sub invalidation is the upgrade
 * path if multi-instance staleness ever matters.
 */

export type PlanFeatureSnapshot = {
  plan_code: string
  feature_keys: ReadonlySet<string>
}

type CacheEntry = PlanFeatureSnapshot & { expires_at: number }

/** How long a snapshot is trusted. */
export const PLAN_CACHE_TTL_MS = 30_000

/**
 * Hard ceiling on entries. Without it a scraper hitting gated routes with
 * forged seller contexts could grow the map without bound.
 */
export const PLAN_CACHE_MAX_ENTRIES = 5_000

const cache = new Map<string, CacheEntry>()

/** Cached snapshot for a seller, or null when absent or stale. */
export function getCachedPlanFeatures(
  seller_id: string,
  now: number = Date.now()
): PlanFeatureSnapshot | null {
  const entry = cache.get(seller_id)
  if (!entry) return null
  if (entry.expires_at <= now) {
    cache.delete(seller_id)
    return null
  }
  return { plan_code: entry.plan_code, feature_keys: entry.feature_keys }
}

export function setCachedPlanFeatures(
  seller_id: string,
  snapshot: PlanFeatureSnapshot,
  now: number = Date.now()
): void {
  // Evict the oldest insertion when at capacity. Map preserves insertion
  // order, so the first key is the oldest — good enough for a bounded cache
  // with a 30s TTL, and avoids tracking access times.
  if (!cache.has(seller_id) && cache.size >= PLAN_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }

  cache.set(seller_id, {
    plan_code: snapshot.plan_code,
    feature_keys: snapshot.feature_keys,
    expires_at: now + PLAN_CACHE_TTL_MS,
  })
}

/**
 * Drop a seller's snapshot.
 *
 * Called synchronously at the end of every plan transition and from the admin
 * assign route, so an upgrade takes effect immediately on the instance that
 * served it rather than after the TTL.
 */
export function invalidateSellerPlan(seller_id: string): void {
  cache.delete(seller_id)
}

/** Drop everything. Tests, and any future global plan-catalog change. */
export function clearPlanFeatureCache(): void {
  cache.clear()
}

/** Current entry count. Exposed for tests and diagnostics. */
export function planFeatureCacheSize(): number {
  return cache.size
}
