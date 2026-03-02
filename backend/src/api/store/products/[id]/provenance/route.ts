import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildFarmHarvestConsistencyIssues } from "../../../../vendor/farm/consistency"

/**
 * GET /store/products/:id/provenance
 * Get farm/harvest provenance information for a product
 * 
 * This endpoint returns the farm story behind a product:
 * - Which producer/farm grew it
 * - Which harvest it came from
 * - Which lot (if linked)
 * - Growing methods and certifications
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const productId = req.params.id

  try {
    // First, get the product's seller
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "seller.id",
        "seller.name",
      ],
      filters: {
        id: productId,
      },
    })

    if (!products || products.length === 0) {
      return res.status(404).json({ message: "Product not found" })
    }

    const product = products[0]
    const sellerId = product.seller?.id

    if (!sellerId) {
      return res.json({ 
        provenance: null,
        message: "No provenance information available"
      })
    }

    // Get producer linked to this seller
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer_id"],
      filters: {
        seller_id: sellerId,
      },
    })

    if (!producerLinks || producerLinks.length === 0) {
      return res.json({ 
        provenance: null,
        message: "No farm information available"
      })
    }

    const producerId = producerLinks[0].producer_id

    // Get producer details
    const { data: producers } = await query.graph({
      entity: "producer",
      fields: [
        "id",
        "name",
        "handle",
        "description",
        "region",
        "state",
        "practices",
        "certifications",
        "story",
        "photo",
        "year_established",
        "verified",
      ],
      filters: {
        id: producerId,
        public_profile_enabled: true,
      },
    })

    if (!producers || producers.length === 0) {
      return res.json({ 
        provenance: null,
        message: "Farm information not public"
      })
    }

    const producer = producers[0]

    // Try to find linked lot for this product (via availability windows)
    const { data: availabilityLinks } = await query.graph({
      entity: "availability_window",
      fields: [
        "id",
        "lot_id",
        "lot.id",
        "lot.lot_number",
        "lot.grade",
        "lot.batch_date",
        "lot.best_by_date",
        "lot.harvest_id",
        "lot.harvest.id",
        "lot.harvest.crop_name",
        "lot.harvest.variety",
        "lot.harvest.harvest_date",
        "lot.harvest.growing_method",
        "lot.harvest.farmer_notes",
        "lot.harvest.taste_notes",
        "lot.harvest.season",
        "lot.harvest.year",
        "lot.harvest.photo",
      ],
      filters: {
        product_id: productId,
        is_active: true,
      },
    })

    let harvest: {
      id: any
      crop_name: any
      variety: any
      harvest_date: any
      growing_method: any
      farmer_notes: any
      taste_notes: any
      season: any
      year: any
      photo: any
    } | null = null
    
    let lot: {
      id: any
      lot_number: any
      grade: any
      batch_date: any
      best_by_date: any
    } | null = null

    if (availabilityLinks && availabilityLinks.length > 0) {
      // Type assertion for linked data
      const link = availabilityLinks[0] as typeof availabilityLinks[0] & {
        lot?: {
          id: string
          lot_number: string
          grade: string
          batch_date: string
          best_by_date: string
          harvest?: {
            id: string
            crop_name: string
            variety: string
            harvest_date: string
            growing_method: string
            farmer_notes: string
            taste_notes: string
            season: string
            year: string
            photo: string
          } | null
        } | null
      }

      lot = link.lot ? {
        id: link.lot.id,
        lot_number: link.lot.lot_number,
        grade: link.lot.grade,
        batch_date: link.lot.batch_date,
        best_by_date: link.lot.best_by_date,
      } : null

      harvest = link.lot?.harvest ? {
        id: link.lot.harvest.id,
        crop_name: link.lot.harvest.crop_name,
        variety: link.lot.harvest.variety,
        harvest_date: link.lot.harvest.harvest_date,
        growing_method: link.lot.harvest.growing_method,
        farmer_notes: link.lot.harvest.farmer_notes,
        taste_notes: link.lot.harvest.taste_notes,
        season: link.lot.harvest.season,
        year: link.lot.harvest.year,
        photo: link.lot.harvest.photo,
      } : null
    }

    // If no linked lot, try to get recent public harvest from producer
    if (!harvest) {
      const { data: recentHarvests } = await query.graph({
        entity: "harvest",
        fields: [
          "id",
          "crop_name",
          "variety",
          "harvest_date",
          "growing_method",
          "farmer_notes",
          "taste_notes",
          "season",
          "year",
          "photo",
        ],
        filters: {
          producer_id: producerId,
          visibility_status: "PUBLIC",
        },
        pagination: {
          take: 1,
          order: { harvest_date: "DESC" }
        }
      })

      if (recentHarvests && recentHarvests.length > 0) {
        harvest = recentHarvests[0]
      }
    }

    const consistency_issues = harvest
      ? buildFarmHarvestConsistencyIssues(producer as any, harvest as any)
      : []

    res.json({
      provenance: {
        producer: {
          id: producer.id,
          name: producer.name,
          handle: producer.handle,
          region: producer.region,
          state: producer.state,
          practices: producer.practices,
          certifications: producer.certifications,
          story: producer.story,
          photo: producer.photo,
          year_established: producer.year_established,
          verified: producer.verified,
        },
        harvest,
        lot,
        consistency_issues,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch provenance",
      error: error.message,
    })
  }
}
