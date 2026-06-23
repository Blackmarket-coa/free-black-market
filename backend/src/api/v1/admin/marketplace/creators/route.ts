import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_EXTENSION_MODULE } from "../../../../../modules/seller-extension"
import type SellerExtensionService from "../../../../../modules/seller-extension/service"

/**
 * GET /v1/admin/marketplace/creators
 *
 * List all sellers with vendor_type=creator. Supports pagination and
 * verified-only filter. Used by the admin panel creator oversight page.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1), 200)
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)
  const verifiedOnly = req.query.verified === "true"

  const service =
    req.scope.resolve<SellerExtensionService>(SELLER_EXTENSION_MODULE)

  const filter: Record<string, unknown> = { vendor_type: "creator" }
  if (verifiedOnly) filter.verified = true

  const creators = await service.listSellerMetadatas(filter, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })

  return res.status(200).json({
    creators: creators.map((c) => ({
      seller_id: c.seller_id,
      handle: c.creator_handle,
      bio: c.creator_bio,
      niches: c.creator_niches ?? [],
      total_followers: Number(c.creator_total_followers ?? 0),
      verified: !!c.verified,
      featured: !!c.featured,
      rating: c.rating,
      review_count: Number(c.review_count ?? 0),
      created_at: c.created_at,
    })),
    limit,
    offset,
  })
}
