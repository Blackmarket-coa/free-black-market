/**
 * The one great-circle distance implementation (W5, decision D5).
 *
 * Before this file the backend carried six copy-pasted haversine functions
 * (store vendors/producers routes, both delivery-zone check routes, the
 * vendor zone-conflict utils, the food-distribution service) plus a seventh
 * km-based variant in `aid-location.ts`. They now all delegate here.
 *
 * Blackout is the ecosystem's spatial home; where a remote answer is
 * appropriate, `lib/blackout-spatial.ts` provides it dark behind
 * `FBM_BLACKOUT_SPATIAL`. Pairwise distance deliberately stays local — it is
 * pure arithmetic with no data dependency, and several callers sit on public
 * hot paths (search, checkout) where a network hop per row is not viable.
 */

export const EARTH_RADIUS_MILES = 3959
export const EARTH_RADIUS_KM = 6371

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Central angle between two points (radians) — haversine, atan2 form. */
function centralAngle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Great-circle distance in miles (the historical R=3959 vendor/zone unit). */
export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  return EARTH_RADIUS_MILES * centralAngle(lat1, lon1, lat2, lon2)
}

/** Great-circle distance in kilometres (the mutual-aid unit). */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  return EARTH_RADIUS_KM * centralAngle(lat1, lon1, lat2, lon2)
}
