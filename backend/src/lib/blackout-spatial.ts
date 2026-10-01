import { createLogger } from "../shared/logger"
import { buildBlackoutSpatialConfig } from "./blackout-spatial-env"
import { distanceMiles } from "./geo-distance"
import { zipToCoords } from "./zip3"

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

/** A US ZIP or ZIP+4. */
const US_ZIP = /^(\d{5})(?:-?\d{4})?$/

/**
 * How far Blackout's answer for a US ZIP may sit from that ZIP's ZIP3
 * centroid and still be taken as the same place. Blackout forwards the bare
 * postal code to the operator's geocoder with no country, and Nominatim ranks
 * foreign postcodes with the same digits first for some ZIPs (94110 →
 * Bavaria, 10115 → Zagreb). Those land thousands of miles out; a real answer
 * lands within the prefix's area. The same bound
 * `lib/blackstar-delivery-payload.ts` applies to a Blackstar origin.
 */
export const MAX_GEOCODE_DRIFT_MILES = 150

/**
 * Is a remote answer for this postal code plausibly the US ZIP it was asked
 * for? Only US-shaped codes (5-digit ZIP or ZIP+4) are checked, against the
 * ZIP3 centroid: within `MAX_GEOCODE_DRIFT_MILES` is kept, anything further
 * is dropped. A US-shaped code with no ZIP3 entry has nothing to check
 * against and is dropped too, so the answer is never a foreign place. Other
 * codes pass through unchanged.
 */
function isConsistentWithZip3(
  postal: string,
  latitude: number,
  longitude: number
): boolean {
  const zip = US_ZIP.exec(postal)?.[1]
  if (!zip) return true
  const local = zipToCoords(zip)
  if (!local) {
    log.warn(`blackout spatial answer for ZIP ${zip} dropped: no ZIP3 entry to check it against`)
    return false
  }
  const drift = distanceMiles(local.lat, local.lng, latitude, longitude)
  if (drift <= MAX_GEOCODE_DRIFT_MILES) return true
  log.warn(
    `blackout spatial answer for ZIP ${zip} is ${Math.round(drift)} mi from its ZIP3 area; using the ZIP3 centroid`
  )
  return false
}

/**
 * Postal code → coordinates via Blackout's geocoder (`GET /v1/spatial/geocode
 * ?q=<postal>`). Null when disabled or on any failure — callers fall back to
 * the ZIP3 table. Successful AND empty answers cache for an hour (postal
 * centroids don't move); failures are not cached so a blip recovers.
 *
 * For a US ZIP, an answer outside the ZIP's ZIP3 area (see
 * `isConsistentWithZip3`) is treated as no answer, so callers fall back to
 * the ZIP3 centroid instead of searching around a foreign postcode. That
 * verdict caches like an empty answer.
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
    typeof first.longitude === "number" &&
    isConsistentWithZip3(postal, first.latitude, first.longitude)
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
