import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  normalizeStorefrontLinks,
  type ExternalStore,
} from "../../../shared/external-stores"

/**
 * GET /store/directory
 * Unified Commerce Hub directory: public producers plus the external stores
 * (Etsy/Shopify/etc.) they sell through. Filterable by q (name/region),
 * region, featured, and platform (only producers selling on that platform).
 *
 * Reuses the producer + seller_metadata read model — no new tables.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query")

  const {
    limit = "30",
    offset = "0",
    q,
    region,
    featured,
    platform,
  } = req.query as Record<string, string>

  try {
    const filters: Record<string, unknown> = { public_profile_enabled: true }
    if (featured === "true") {
      filters.featured = true
    }
    if (region) {
      filters.region = region
    }

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
        "photo",
        "cover_image",
        "featured",
        "verified",
      ],
      filters,
      pagination: {
        skip: parseInt(offset, 10) || 0,
        take: Math.min(parseInt(limit, 10) || 30, 100),
        order: { featured: "DESC", name: "ASC" },
      },
    })

    let rows = producers || []

    if (q) {
      const needle = q.toLowerCase()
      rows = rows.filter(
        (p: any) =>
          p.name?.toLowerCase().includes(needle) ||
          p.description?.toLowerCase().includes(needle) ||
          p.region?.toLowerCase().includes(needle)
      )
    }

    // Batch-join external stores via seller_metadata.
    const sellerIds = [
      ...new Set(rows.map((p: any) => p.seller_id).filter(Boolean)),
    ]
    const storesBySeller = new Map<string, ExternalStore[]>()
    if (sellerIds.length > 0) {
      const { data: metaRows } = await query.graph({
        entity: "seller_metadata",
        fields: ["seller_id", "storefront_links", "website_url"],
        filters: { seller_id: sellerIds },
      })
      for (const meta of metaRows || []) {
        storesBySeller.set(
          meta.seller_id,
          normalizeStorefrontLinks(meta.storefront_links, meta.website_url)
        )
      }
    }

    let entries = rows.map((p: any) => ({
      id: p.id,
      name: p.name,
      handle: p.handle,
      description: p.description,
      region: p.region,
      state: p.state,
      photo: p.photo,
      cover_image: p.cover_image,
      featured: p.featured,
      verified: p.verified,
      external_stores: p.seller_id
        ? storesBySeller.get(p.seller_id) ?? []
        : [],
    }))

    if (platform) {
      const wanted = platform.toLowerCase()
      entries = entries.filter((e) =>
        e.external_stores.some((s) => s.platform.toLowerCase() === wanted)
      )
    }

    res.json({
      producers: entries,
      count: entries.length,
      limit: Math.min(parseInt(limit, 10) || 30, 100),
      offset: parseInt(offset, 10) || 0,
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch directory",
      error: error.message,
    })
  }
}
