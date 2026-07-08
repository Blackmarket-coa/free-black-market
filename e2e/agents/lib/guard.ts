/**
 * guard.ts — fail-closed loopback guard.
 *
 * This harness is LOCAL-ONLY, non-negotiable. Every target URL it
 * touches (storefront, backend, admin, vendor) MUST resolve to a loopback host
 * (localhost / 127.0.0.1 / [::1]). If any target is off-loopback the harness
 * REFUSES TO RUN — it throws before a single page loads or request fires. This
 * is the first line of defence; the repo's PreToolUse egress guard is the
 * seatbelt behind it.
 *
 * This module holds ZERO secrets and hardcodes NO keys. The store publishable
 * key is read ONLY from `process.env.STORE_PUBLISHABLE_KEY` (empty string when
 * unset). A publishable Medusa key is client-side and non-secret, but a clean
 * contribution hardcodes none — so when it is unset the harness-side
 * differential oracle degrades to a skip. Persona/agent code never uses it.
 */

/** The four service URLs the harness may target — all loopback by default. */
export interface TargetUrls {
  storefront: string
  backend: string
  admin: string
  vendor: string
}

/** Store publishable key + region for the read-only differential oracle. */
export interface StoreContext {
  publishableKey: string
  regionId: string
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

// No publishable key is hardcoded here — it comes only from
// STORE_PUBLISHABLE_KEY (see storeContext, below). The region id is not a
// secret and is safe to default to the seeded local region.
const DEFAULT_REGION_ID = "reg_01KWQZF8WM4RHC4ZMYHBRZXKVD"

/** True if `host` (no port) is a loopback address. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase())
}

/** Parse a URL and return its hostname, throwing a clear error if unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    throw new Error(`[agents:guard] not a valid URL: ${JSON.stringify(url)}`)
  }
}

/**
 * Throw unless `url`'s host is loopback. `label` names the surface in the error.
 * Call this before any navigation or request that uses `url`.
 */
export function assertLoopback(url: string, label = "target"): void {
  const host = hostOf(url)
  if (!isLoopbackHost(host)) {
    throw new Error(
      `[agents:guard] REFUSING TO RUN — ${label} host ${JSON.stringify(host)} ` +
        `is not loopback (${url}). This harness is local-only. ` +
        `Point ${label} at localhost / 127.0.0.1 or do not run it here.`
    )
  }
}

/** Read the four target URLs from env (localhost defaults). */
export function targets(): TargetUrls {
  return {
    storefront: process.env.STOREFRONT_URL || "http://localhost:3000",
    backend: process.env.BACKEND_URL || "http://localhost:9000",
    admin: process.env.ADMIN_URL || "http://localhost:7000",
    vendor: process.env.VENDOR_URL || "http://localhost:7001",
  }
}

/**
 * Read the store publishable key + region. The key is env-only and defaults to
 * an EMPTY string when `STORE_PUBLISHABLE_KEY` is unset — no key is hardcoded.
 * An empty key tells the differential oracle to degrade to a skip.
 */
export function storeContext(): StoreContext {
  return {
    publishableKey: process.env.STORE_PUBLISHABLE_KEY || "",
    regionId: process.env.STORE_REGION_ID || DEFAULT_REGION_ID,
  }
}

/**
 * Fail-closed startup guard: assert EVERY target URL is loopback. Called by the
 * agent fixture and the differential oracle before they do anything. Pass a
 * partial to check a subset; omit to check all four env-derived targets.
 */
export function assertLoopbackTargets(t: Partial<TargetUrls> = targets()): void {
  const merged = { ...targets(), ...t }
  assertLoopback(merged.storefront, "STOREFRONT_URL")
  assertLoopback(merged.backend, "BACKEND_URL")
  assertLoopback(merged.admin, "ADMIN_URL")
  assertLoopback(merged.vendor, "VENDOR_URL")
}
