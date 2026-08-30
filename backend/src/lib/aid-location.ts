/**
 * Location handling for mutual aid.
 *
 * Mutual aid records where people in need are. That is the most sensitive data
 * this product touches, and a public request board is the easiest place in the
 * world to leak it — one careless `res.json(request)` and a stranger can map
 * every vulnerable household in a city.
 *
 * So precise coordinates never leave the server on a public read. They exist to
 * match a request to an offer and to route a delivery once both sides have
 * agreed; everything shown to anyone else is a coarse label the person chose,
 * or a distance band, or nothing.
 *
 * `toPublicAid` is the only sanctioned way to turn a row into a response. It
 * whitelists rather than deletes: a projection that removes known-bad fields
 * silently starts leaking the day someone adds a column, whereas one that only
 * emits what it lists cannot.
 */

import { distanceKm as greatCircleKm } from "./geo-distance"

export type AidLocated = {
  latitude?: number | null
  longitude?: number | null
  locality?: string | null
}

/** Great-circle distance in km. Null when either side has no coordinates. */
export function distanceKm(
  a: AidLocated,
  b: AidLocated
): number | null {
  if (
    a.latitude == null ||
    a.longitude == null ||
    b.latitude == null ||
    b.longitude == null
  ) {
    return null
  }

  // Math consolidated into lib/geo-distance (W5); the null semantics and the
  // privacy projection in this file are unchanged and stay LOCAL by design —
  // aid coordinates never leave the server, remote spatial calls included.
  return greatCircleKm(a.latitude, a.longitude, b.latitude, b.longitude)
}

/**
 * Whether an offer's reach covers a request.
 *
 * An offer with no stated radius is treated as unbounded, and a pair with no
 * coordinates is treated as reachable rather than unreachable. Both defaults
 * point the same way on purpose: excluding a willing helper because someone
 * declined to share a location is a worse failure than showing them a match
 * they turn out not to want.
 */
export function isWithinReach(
  request: AidLocated,
  offer: AidLocated & { service_radius_km?: number | null }
): boolean {
  const d = distanceKm(request, offer)
  if (d === null) return true
  if (offer.service_radius_km == null) return true
  return d <= offer.service_radius_km
}

/**
 * Coarse distance, for telling someone roughly how close a match is without
 * handing over a position. Exact kilometres are themselves a locator: publish
 * enough of them from known offers and you can trilaterate a household.
 */
export function distanceBand(km: number | null): string | null {
  if (km === null) return null
  if (km < 2) return "under 2km"
  if (km < 5) return "2-5km"
  if (km < 15) return "5-15km"
  if (km < 50) return "15-50km"
  return "over 50km"
}

export type PublicAidFields = {
  id: string
  title: string
  description: string
  category: string | null
  status: string
  quantity: number | null
  unit_of_measure: string | null
  /** Coarse label only — never coordinates. */
  locality: string | null
  distance_band?: string | null
  created_at?: string | null
}

type AidRow = Record<string, unknown>

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Project a request or offer into something safe to publish.
 *
 * Whitelist-only. Adding a column to either model does not silently widen what
 * this emits, which is the property that matters for data this sensitive.
 * `viewer` supplies an optional vantage point so a distance *band* can be
 * included without ever revealing a position.
 */
export function toPublicAid(row: AidRow, viewer?: AidLocated): PublicAidFields {
  const located: AidLocated = {
    latitude: num(row.latitude),
    longitude: num(row.longitude),
  }

  const band = viewer ? distanceBand(distanceKm(located, viewer)) : undefined

  const createdAt = row.created_at
  return {
    id: String(row.id),
    title: str(row.title) ?? "",
    description: str(row.description) ?? "",
    category: str(row.category),
    status: str(row.status) ?? "OPEN",
    quantity: num(row.quantity),
    unit_of_measure: str(row.unit_of_measure),
    locality: str(row.locality),
    ...(band !== undefined ? { distance_band: band } : {}),
    created_at:
      createdAt instanceof Date
        ? createdAt.toISOString()
        : str(createdAt) ?? null,
  }
}
