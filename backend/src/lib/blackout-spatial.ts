import { createLogger } from "../shared/logger"
import { buildBlackoutSpatialConfig } from "./blackout-spatial-env"

const log = createLogger("lib/blackout-spatial")

/**
 * Consumer of Blackout's `/v1/spatial` service surface (W5, decision D5:
 * Blackout is the ecosystem's spatial home). Dark behind
 * `FBM_BLACKOUT_SPATIAL` and STRICTLY FAIL-SOFT: every failure — disabled,
 * timeout, non-200, malformed body — resolves to null and the caller falls
 * back to the local answer (the ZIP3 table). Geo must never hard-fail a
 * store route; several callers sit on the public search and checkout paths.
 *
 * Contract: docs/contracts/blackout-spatial-consumer.md. Client shape
 * mirrors printful-fulfillment/client.ts (one private request helper, thin
 * typed methods); the env gate is the separate pure module so combinations
 * are unit-testable.
 */

export interface RemoteGeocodeResult {
  latitude: number
  longitude: number
  label: string
  /** Blackout's geocoder resolves real localities — still approximate for a bare postal code. */
  approximate: boolean
}

const TIMEOUT_MS = 4000
const MAX_RESPONSE_BYTES = 64 * 1024
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 5000

type CacheEntry = { value: RemoteGeocodeResult | null; expiresAt: number }
const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry
}

function cacheSet(key: string, value: RemoteGeocodeResult | null): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Insertion-ordered Map: drop the oldest entry.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** Test hook. */
export function clearBlackoutSpatialCache(): void {
  cache.clear()
}

async function spatialGet(path: string): Promise<unknown | null> {
  const config = buildBlackoutSpatialConfig()
  if (!config) return null
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      headers: {
        accept: "application/json",
        "x-spatial-token": config.token,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      log.warn(`blackout spatial ${path.split("?")[0]} returned ${response.status}`)
      return null
    }
    const body = await response.text()
    if (body.length > MAX_RESPONSE_BYTES) {
      log.warn("blackout spatial response too large")
      return null
    }
    return JSON.parse(body)
  } catch (error) {
    log.warn(
      `blackout spatial call failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

/**
 * Postal code → coordinates via Blackout's geocoder (`GET /v1/spatial/geocode
 * ?q=<postal>`). Null when disabled or on any failure — callers fall back to
 * the ZIP3 table. Successful AND empty answers cache for an hour (postal
 * centroids don't move); failures are not cached so a blip recovers.
 */
export async function geocodePostalCode(
  postalCode: string
): Promise<RemoteGeocodeResult | null> {
  const postal = postalCode.trim()
  if (postal.length < 3) return null
  if (!buildBlackoutSpatialConfig()) return null

  const key = `postal:${postal.toLowerCase()}`
  const cached = cacheGet(key)
  if (cached) return cached.value

  const payload = await spatialGet(`/v1/spatial/geocode?q=${encodeURIComponent(postal)}`)
  if (!payload || typeof payload !== "object") return null

  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results)) return null
  const first = results[0] as
    | { latitude?: unknown; longitude?: unknown; label?: unknown }
    | undefined

  const value: RemoteGeocodeResult | null =
    first &&
    typeof first.latitude === "number" &&
    typeof first.longitude === "number"
      ? {
          latitude: first.latitude,
          longitude: first.longitude,
          label: typeof first.label === "string" ? first.label : postal,
          approximate: true,
        }
      : null

  cacheSet(key, value)
  return value
}
