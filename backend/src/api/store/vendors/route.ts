import { createLogger } from "../../../shared/logger"
import { distanceMiles } from "../../../lib/geo-distance"
import { zipToCoords } from "../../../lib/zip3"
const log = createLogger("api/store/vendors")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VendorType } from "../../../modules/seller-extension/models/seller-metadata"
import { VENDOR_VERIFICATION_MODULE } from "../../../modules/vendor-verification"
import type VendorVerificationService from "../../../modules/vendor-verification/service"

/**
 * Archetypes this endpoint fetches through their own dedicated entity query
 * (the `producer`, `kitchen` and `garden` tables), earlier in the handler.
 */
export const DEDICATED_ENTITY_VENDOR_TYPES: string[] = [
  "producer",
  "kitchen",
  "garden",
]

/**
 * Every other archetype, which exists only as a `seller_metadata` row.
 *
 * Derived from `VendorType` so that adding an archetype makes it visible in
 * the public directory automatically. The previous hardcoded list is why
 * `creator` sellers never appeared here.
 */
export const METADATA_BACKED_VENDOR_TYPES: string[] = Object.values(
  VendorType
).filter((type) => !DEDICATED_ENTITY_VENDOR_TYPES.includes(type))

// Distance math consolidated into lib/geo-distance (W5).

// ZIP3 lookup consolidated into lib/zip3 (W5).

/**
 * GET /store/vendors
 *
 * Unified vendor listing endpoint that aggregates all vendor types
 * into a single customer-facing directory.
 *
 * Query params:
 * - vendor_type: Filter by type (producer, garden, kitchen, maker, restaurant, mutual_aid)
 * - search: Text search on name, description, location
 * - featured: "true" to show only featured vendors
 * - lat: Latitude for distance filtering
 * - lng: Longitude for distance filtering
 * - zip: US zip code for distance filtering (converted to lat/lng)
 * - radius_miles: Max distance in miles (default 50)
 * - has_photo: "true" to show only vendors with a profile picture
 * - sort: "newest" to sort by creation date descending (default: featured first, then name)
 * - limit: Results per page (default 50)
 * - offset: Pagination offset (default 0)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query")

  const {
    vendor_type,
    search,
    featured,
    lat,
    lng,
    zip,
    radius_miles = "50",
    has_photo,
    sort,
    limit = "50",
    offset = "0",
  } = req.query as Record<string, any>

  // Resolve coordinates from zip if lat/lng not provided
  let userLat = lat ? parseFloat(lat) : NaN
  let userLng = lng ? parseFloat(lng) : NaN

  if (isNaN(userLat) && isNaN(userLng) && zip) {
    const coords = zipToCoords(String(zip))
    if (coords) {
      userLat = coords.lat
      userLng = coords.lng
    }
  }

  const hasLocationFilter = !isNaN(userLat) && !isNaN(userLng)
  const maxRadius = parseFloat(radius_miles) || 50

  try {
    const vendors: any[] = []

    // 1. Fetch producers
    if (!vendor_type || vendor_type === "producer") {
      try {
        const producerFilters: Record<string, any> = {
          public_profile_enabled: true,
        }
        if (featured === "true") producerFilters.featured = true

        const { data: producers } = await query.graph({
          entity: "producer",
          fields: [
            "id",
            "seller_id",
            "name",
            "handle",
            "description",
            "region",
            "state",
            "country_code",
            "latitude",
            "longitude",
            "practices",
            "certifications",
            "photo",
            "cover_image",
            "featured",
            "verified",
            "year_established",
            "created_at",
          ],
          filters: producerFilters,
        })

        for (const p of producers || []) {
          if (!p.handle) continue
          vendors.push({
            id: p.id,
            seller_id: p.seller_id,
            name: p.name,
            handle: p.handle,
            description: p.description,
            vendor_type: "producer",
            vendor_type_label: "Grower & Producer",
            photo: p.photo || p.cover_image,
            location: {
              region: p.region,
              state: p.state,
              country_code: p.country_code,
              latitude: p.latitude,
              longitude: p.longitude,
            },
            practices: p.practices,
            certifications: p.certifications,
            featured: p.featured,
            verified: p.verified,
            year_established: p.year_established,
            created_at: p.created_at,
            profile_url: `/producers/${p.handle}`,
          })
        }
      } catch (err) {
        log.warn("Could not fetch producers:", err)
      }
    }

    // 2. Fetch kitchens
    if (!vendor_type || vendor_type === "kitchen") {
      try {
        const { data: kitchens } = await query.graph({
          entity: "kitchen",
          fields: [
            "id",
            "name",
            "slug",
            "description",
            "city",
            "state",
            "zip",
            "coordinates",
            "kitchen_type",
            "status",
            "total_stations",
            "total_sqft",
            "hourly_rate",
            "certifications",
            "cover_image_url",
            "created_at",
          ],
          filters: { status: "active" },
        })

        for (const k of kitchens || []) {
          if (!k.slug) continue
          const coords = k.coordinates as any
          vendors.push({
            id: k.id,
            name: k.name,
            handle: k.slug,
            description: k.description,
            vendor_type: "kitchen",
            vendor_type_label: "Shared Kitchen",
            photo: k.cover_image_url,
            location: {
              city: k.city,
              state: k.state,
              zip: k.zip,
              latitude: coords?.lat,
              longitude: coords?.lng,
            },
            kitchen_type: k.kitchen_type,
            total_stations: k.total_stations,
            total_sqft: k.total_sqft,
            hourly_rate: k.hourly_rate,
            certifications: k.certifications,
            featured: false,
            verified: false,
            created_at: k.created_at,
            profile_url: `/kitchens/${k.slug}`,
          })
        }
      } catch (err) {
        log.warn("Could not fetch kitchens:", err)
      }
    }

    // 3. Fetch gardens
    if (!vendor_type || vendor_type === "garden") {
      try {
        const { data: gardens } = await query.graph({
          entity: "garden",
          fields: [
            "id",
            "name",
            "slug",
            "description",
            "city",
            "state",
            "zip",
            "coordinates",
            "status",
            "total_plots",
            "total_sqft",
            "cover_image_url",
            "gallery_urls",
            "created_at",
          ],
          filters: { status: "active" } as any,
        })

        for (const g of gardens || []) {
          if (!g.slug) continue
          const coords = g.coordinates as { lat?: number; lng?: number } | null
          const galleryUrls = g.gallery_urls as string[] | null
          vendors.push({
            id: g.id,
            name: g.name,
            handle: g.slug,
            description: g.description,
            vendor_type: "garden",
            vendor_type_label: "Community Growing Space",
            photo: g.cover_image_url || (galleryUrls?.[0] ?? undefined),
            location: {
              city: g.city,
              state: g.state,
              zip: g.zip,
              latitude: coords?.lat,
              longitude: coords?.lng,
            },
            total_plots: g.total_plots,
            total_sqft: g.total_sqft,
            featured: false,
            verified: false,
            created_at: g.created_at,
            profile_url: `/gardens/${g.slug}`,
          })
        }
      } catch (err) {
        log.warn("Could not fetch gardens:", err)
      }
    }

    // 4. Fetch every remaining seller type via seller_metadata.
    //
    // The set is DERIVED (all archetypes minus the three with dedicated entity
    // queries above) rather than enumerated. It used to be the hardcoded list
    // ["maker", "restaurant", "mutual_aid"], which meant any archetype added
    // later was invisible in this endpoint on both paths — `?vendor_type=X`
    // matched no branch and returned nothing, and the unfiltered "all vendors"
    // listing enumerated only those three. `creator` has been missing from the
    // public directory that way since it was introduced.
    if (!vendor_type || METADATA_BACKED_VENDOR_TYPES.includes(vendor_type)) {
      try {
        const metadataFilters: Record<string, any> = {}
        if (vendor_type && METADATA_BACKED_VENDOR_TYPES.includes(vendor_type)) {
          metadataFilters.vendor_type = vendor_type
        } else if (!vendor_type) {
          // Everything not already fetched by the branches above.
          metadataFilters.vendor_type = METADATA_BACKED_VENDOR_TYPES
        }
        if (featured === "true") metadataFilters.featured = true

        const { data: sellerMetadata } = await query.graph({
          entity: "seller_metadata",
          fields: [
            "id",
            "seller_id",
            "vendor_type",
            "featured",
            "verified",
            "rating",
            "social_links",
            "website_url",
            "certifications",
          ],
          filters: metadataFilters,
        })

        const vendorTypeLabels: Record<string, string> = {
          maker: "Maker & Brand",
          restaurant: "Food Business",
          mutual_aid: "Community Organization",
          creator: "Creator",
          general: "Business",
        }

        for (const meta of sellerMetadata || []) {
          if (!meta.seller_id) continue
          try {
            const { data: sellers } = await query.graph({
              entity: "seller",
              fields: ["id", "name", "handle", "description", "photo", "created_at"],
              filters: { id: meta.seller_id },
            })

            const seller = sellers?.[0]
            if (!seller) continue

            if (!seller.handle) {
              // A handle-less seller would produce a dead "/sellers/null"
              // profile link in the directory — skip it and flag the data.
              log.warn(
                `Seller ${seller.id} (${seller.name}) has no handle; excluded from vendor directory`
              )
              continue
            }

            vendors.push({
              // Use the seller id as the canonical vendor id for seller-backed vendor types.
              // This keeps ids consistent with seller data used across storefront/vendor panel APIs.
              id: meta.seller_id,
              metadata_id: meta.id,
              seller_id: meta.seller_id,
              name: seller.name,
              handle: seller.handle,
              description: seller.description,
              vendor_type: meta.vendor_type,
              vendor_type_label:
                vendorTypeLabels[meta.vendor_type] || meta.vendor_type,
              photo: seller.photo,
              location: {},
              featured: meta.featured,
              verified: meta.verified,
              rating: meta.rating,
              website_url: meta.website_url,
              certifications: meta.certifications,
              created_at: seller.created_at,
              profile_url: `/sellers/${seller.handle}`,
            })
          } catch {
            // Skip sellers that can't be fetched
          }
        }
      } catch (err) {
        log.warn("Could not fetch seller metadata:", err)
      }
    }

    // Apply search filter
    let filteredVendors = vendors
    if (search) {
      const searchLower = (search as string).toLowerCase()
      filteredVendors = filteredVendors.filter(
        (v) =>
          v.name?.toLowerCase().includes(searchLower) ||
          v.description?.toLowerCase().includes(searchLower) ||
          v.location?.region?.toLowerCase().includes(searchLower) ||
          v.location?.city?.toLowerCase().includes(searchLower) ||
          v.location?.state?.toLowerCase().includes(searchLower)
      )
    }

    // Apply has_photo filter
    if (has_photo === "true") {
      filteredVendors = filteredVendors.filter((v) => v.photo)
    }

    // Apply distance filter
    if (hasLocationFilter) {
      filteredVendors = filteredVendors
        .map((v) => {
          const vLat = v.location?.latitude
          const vLng = v.location?.longitude
          if (vLat != null && vLng != null) {
            const distance = distanceMiles(userLat, userLng, vLat, vLng)
            return { ...v, distance: Math.round(distance * 10) / 10 }
          }
          return { ...v, distance: null }
        })
        .filter((v) => v.distance !== null && v.distance <= maxRadius)
        .sort((a, b) => (a.distance || 0) - (b.distance || 0))
    } else if (sort === "newest") {
      // Sort by creation date, newest first
      filteredVendors.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA
      })
    } else {
      // Sort by featured first, then name
      filteredVendors.sort((a, b) => {
        if (a.featured && !b.featured) return -1
        if (!a.featured && b.featured) return 1
        return (a.name || "").localeCompare(b.name || "")
      })
    }

    // Apply pagination
    const parsedOffset = parseInt(offset, 10) || 0
    const parsedLimit = parseInt(limit, 10) || 50
    const paginatedVendors = filteredVendors.slice(
      parsedOffset,
      parsedOffset + parsedLimit
    )

    // Attach the real verification level to the page being returned.
    //
    // Every branch above sets a `verified` boolean — from `seller_metadata` in
    // some cases, hardcoded `false` in others — which is a second, weaker
    // source of truth than the five-level `vendor_verification` record. A card
    // reading "Verified" off a metadata flag can disagree with what the seller
    // page shows, so the level is resolved here and takes precedence.
    //
    // Enriched after pagination, in one query for the whole page, so this costs
    // a single extra read rather than one per vendor in the unpaginated set.
    const withVerification = await attachVerificationLevels(
      req,
      paginatedVendors
    )

    res.json({
      vendors: withVerification,
      count: filteredVendors.length,
      limit: parsedLimit,
      offset: parsedOffset,
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch vendors",
      error: error.message,
    })
  }
}

/**
 * Resolve each vendor's verification level from `vendor_verification`.
 *
 * Vendors keyed by `seller_id` where present, falling back to `id` — the
 * archetype branches above build rows from different entities, and only some
 * of them carry an explicit seller id.
 *
 * Failure is non-fatal: the listing is the point of the endpoint, and a
 * verification read that errors should downgrade the badge, not 500 the page.
 */
async function attachVerificationLevels(
  req: MedusaRequest,
  vendors: Array<Record<string, any>>
): Promise<Array<Record<string, any>>> {
  if (vendors.length === 0) return vendors

  try {
    const service = req.scope.resolve<VendorVerificationService>(
      VENDOR_VERIFICATION_MODULE
    )

    const sellerIds = Array.from(
      new Set(
        vendors
          .map((v) => v.seller_id || v.id)
          .filter((id): id is string => typeof id === "string")
      )
    )

    const records = await service.listVendorVerifications({
      seller_id: sellerIds,
    })

    const levelBySeller = new Map(
      records.map((record) => [record.seller_id, record.level])
    )

    return vendors.map((vendor) => {
      const level = levelBySeller.get(vendor.seller_id || vendor.id)
      if (!level) return vendor
      return {
        ...vendor,
        verification_level: level,
        // Only the reviewed levels count as verified to a buyer.
        // SELF_REPORTED means the seller told us, not that we checked.
        verified: ["VERIFIED", "AUDITED", "CERTIFIED"].includes(level),
      }
    })
  } catch (err) {
    log.warn("Could not attach verification levels:", err)

return vendors
  }
}
