import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  normalizeStorefrontLinks,
  type ExternalStore,
} from "../../../../shared/external-stores"

/**
 * GET /store/producers/:handle
 * Get a public producer profile by handle
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const handle = req.params.handle

  try {
    // Get producer by handle
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
        "farm_size_acres",
        "year_established",
        "practices",
        "certifications",
        "story",
        "photo",
        "cover_image",
        "gallery",
        "website",
        "social_links",
        "featured",
        "verified",
        "verified_at",
        "created_at",
      ],
      filters: {
        handle,
        public_profile_enabled: true,
      },
    })

    if (!producers || producers.length === 0) {
      return res.status(404).json({ message: "Producer not found" })
    }

    const producer = producers[0]

    // Get active harvests for this producer (public ones only)
    const { data: harvests } = await query.graph({
      entity: "harvest",
      fields: [
        "id",
        "crop_name",
        "variety",
        "category",
        "harvest_date",
        "season",
        "year",
        "growing_method",
        "farmer_notes",
        "taste_notes",
        "photo",
        "visibility_status",
      ],
      filters: {
        producer_id: producer.id,
        visibility_status: "PUBLIC",
      },
      pagination: {
        take: 10,
        order: { harvest_date: "DESC" }
      }
    })

    // Get seller products via the seller_id link
    let products: any[] = []
    if (producer.seller_id) {
      const { data: sellerProducts } = await query.graph({
        entity: "product",
        fields: [
          "id",
          "title",
          "handle",
          "thumbnail",
          "status",
        ],
        filters: {
          // @ts-ignore - seller relation exists
          "seller.id": producer.seller_id,
          status: "published",
        },
        pagination: {
          take: 12,
        }
      })
      products = sellerProducts || []
    }

    // External storefront links live on seller_metadata (Commerce Hub).
    let externalStores: ExternalStore[] = []
    if (producer.seller_id) {
      const { data: metaRows } = await query.graph({
        entity: "seller_metadata",
        fields: ["storefront_links", "website_url"],
        filters: { seller_id: producer.seller_id },
      })
      const meta = metaRows?.[0]
      if (meta) {
        externalStores = normalizeStorefrontLinks(
          meta.storefront_links,
          meta.website_url
        )
      }
    }

    res.json({
      producer: {
        ...producer,
        harvests: harvests || [],
        products,
        external_stores: externalStores,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch producer",
      error: error.message,
    })
  }
}
