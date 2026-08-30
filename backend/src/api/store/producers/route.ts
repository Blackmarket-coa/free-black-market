import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { distanceMiles } from "../../../lib/geo-distance"

// Distance math consolidated into lib/geo-distance (W5).

/**
 * GET /store/producers
 * List all public producers/farms
 *
 * Supports filtering by: featured, region, search, and distance (lat/lng/radius_miles)
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")

  const {
    limit = 20,
    offset = 0,
    featured,
    region,
    search,
    lat,
    lng,
    radius_miles = "50",
  } = req.query as Record<string, any>

  try {
    const filters: Record<string, any> = {
      public_profile_enabled: true,
    }

    if (featured === 'true') {
      filters.featured = true
    }

    if (region) {
      filters.region = region
    }

    // Get public producers (include lat/lng for distance filtering)
    const { data: producers } = await query.graph({
      entity: "producer",
      fields: [
        "id",
        "name",
        "handle",
        "description",
        "region",
        "state",
        "country_code",
        "latitude",
        "longitude",
        "farm_size_acres",
        "year_established",
        "practices",
        "certifications",
        "story",
        "photo",
        "cover_image",
        "featured",
        "verified",
        "created_at",
      ],
      filters,
      pagination: {
        skip: parseInt(offset as string, 10),
        take: parseInt(limit as string, 10),
        order: { featured: "DESC", name: "ASC" }
      }
    })

    // If search, filter by name (basic search)
    let filteredProducers = producers || []
    if (search) {
      const searchLower = (search as string).toLowerCase()
      filteredProducers = filteredProducers.filter((p: any) =>
        p.name?.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower) ||
        p.region?.toLowerCase().includes(searchLower)
      )
    }

    // Distance filtering
    if (lat && lng) {
      const userLat = parseFloat(lat)
      const userLng = parseFloat(lng)
      const maxRadius = parseFloat(radius_miles) || 50

      if (!isNaN(userLat) && !isNaN(userLng)) {
        filteredProducers = filteredProducers
          .map((p: any) => {
            if (p.latitude != null && p.longitude != null) {
              const distance = distanceMiles(
                userLat,
                userLng,
                p.latitude,
                p.longitude
              )
              return { ...p, distance: Math.round(distance * 10) / 10 }
            }
            return { ...p, distance: null }
          })
          .filter((p: any) => p.distance !== null && p.distance <= maxRadius)
          .sort((a: any, b: any) => (a.distance || 0) - (b.distance || 0))
      }
    }

    res.json({
      producers: filteredProducers,
      count: filteredProducers.length,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch producers",
      error: error.message,
    })
  }
}
