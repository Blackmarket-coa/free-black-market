import type { z } from "zod"
import { createDeliveryZoneSchema } from "../../delivery-zones/contracts"
import { distanceMiles } from "../../../lib/geo-distance"

type ZoneInput = z.infer<typeof createDeliveryZoneSchema>

export type ExistingZone = {
  id: string
  name: string
  code: string
  active: boolean
  center_latitude: number
  center_longitude: number
  boundary?: { type: string; coordinates: number[][][] } | null
}

// Distance math consolidated into lib/geo-distance (W5).

const estimateRadiusMiles = (zone: Pick<ZoneInput, "center_latitude" | "center_longitude" | "boundary">) => {
  const polygon = zone.boundary?.coordinates?.[0]
  if (!polygon?.length) return 0

  let maxDistance = 0

  for (const [lng, lat] of polygon) {
    maxDistance = Math.max(
      maxDistance,
      distanceMiles(zone.center_latitude, zone.center_longitude, lat, lng)
    )
  }

  return maxDistance
}

const polygonBbox = (polygon: number[][]) => {
  const lngs = polygon.map((point) => point[0])
  const lats = polygon.map((point) => point[1])

  return {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  }
}

const hasBboxOverlap = (left: ReturnType<typeof polygonBbox>, right: ReturnType<typeof polygonBbox>) => {
  return !(left.maxLng < right.minLng || left.minLng > right.maxLng || left.maxLat < right.minLat || left.minLat > right.maxLat)
}

export const detectDeliveryZoneConflicts = (
  candidate: ZoneInput,
  zones: ExistingZone[],
  excludingZoneId?: string
) => {
  const candidateRadius = estimateRadiusMiles(candidate)
  const candidatePolygon = candidate.boundary.coordinates[0]
  const candidateBbox = polygonBbox(candidatePolygon)

  return zones
    .filter((zone) => zone.active && zone.id !== excludingZoneId)
    .map((zone) => {
      const zoneBoundary = zone.boundary as { type: string; coordinates: number[][][] } | undefined
      const zonePolygon = zoneBoundary?.coordinates?.[0] || []
      const zoneBbox = zonePolygon.length ? polygonBbox(zonePolygon) : null
      const zoneRadius = zonePolygon.length
        ? estimateRadiusMiles({
            center_latitude: zone.center_latitude,
            center_longitude: zone.center_longitude,
            boundary: {
              type: "Polygon",
              coordinates: [zonePolygon],
            },
          } as ZoneInput)
        : 0

      const centersDistance = distanceMiles(
        candidate.center_latitude,
        candidate.center_longitude,
        zone.center_latitude,
        zone.center_longitude
      )

      const radiusConflict = centersDistance <= candidateRadius + zoneRadius
      const polygonConflict = zoneBbox ? hasBboxOverlap(candidateBbox, zoneBbox) : false

      if (!radiusConflict && !polygonConflict) {
        return null
      }

      return {
        zone_id: zone.id,
        zone_name: zone.name,
        zone_code: zone.code,
        type: radiusConflict ? "radius_conflict" : "polygon_overlap",
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}
