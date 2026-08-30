import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { zipToCoords } from "../../../lib/zip3"
import { geocodePostalCode } from "../../../lib/blackout-spatial"

/**
 * GET /store/geocode?postal_code=48201  (alias: ?zip=)
 *
 * Postal code → approximate coordinates, for the storefront's "enter your
 * ZIP" boxes (vendors/producers discovery, delivery-zone check on the
 * checkout path). W5 (decision D5): remote-first via Blackout's spatial
 * surface when `FBM_BLACKOUT_SPATIAL` is enabled (real geocoding instead of
 * prefix centroids), with the local ZIP3 table as the always-available
 * fallback — geo never hard-fails a store route.
 *
 * Response mirrors the storefront's historical /api/geocode contract:
 * `{ zip, latitude, longitude, approximate }` (+ `source`).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const raw = req.query.postal_code ?? req.query.zip
  const postal = typeof raw === "string" ? raw.trim() : ""

  if (postal.length < 3) {
    return res.status(400).json({
      error: "Please provide a valid US zip code",
      type: "invalid_data",
    })
  }

  // Remote-first when configured; null on disabled/any failure.
  const remote = await geocodePostalCode(postal)
  if (remote) {
    return res.json({
      zip: postal,
      latitude: remote.latitude,
      longitude: remote.longitude,
      approximate: remote.approximate,
      source: "blackout-spatial",
    })
  }

  const coords = zipToCoords(postal)
  if (!coords) {
    return res.status(404).json({
      error: "Could not find coordinates for this zip code",
      type: "not_found",
    })
  }

  return res.json({
    zip: postal,
    latitude: coords.lat,
    longitude: coords.lng,
    approximate: true,
    source: "zip3",
  })
}
