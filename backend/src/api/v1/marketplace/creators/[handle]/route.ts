import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SELLER_EXTENSION_MODULE } from "../../../../../modules/seller-extension"

/**
 * Public creator profile endpoint.
 *
 * GET /v1/marketplace/creators/:handle
 *
 * Returns the creator's public profile (handle, bio, niches, follower count,
 * social links). Used by the storefront `/creators/[handle]` page and by
 * external content platforms (Blackout, etc.) to display embedded creator info.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = (req.params as { handle?: string })?.handle
  if (!handle) {
    return res.status(400).json({
      message: "Missing creator handle",
      type: "invalid_request",
    })
  }

  const service = req.scope.resolve<any>(SELLER_EXTENSION_MODULE)

  const matches = await service.listSellerMetadata({
    creator_handle: handle,
    vendor_type: "creator",
  })

  if (!matches || matches.length === 0) {
    return res.status(404).json({
      message: "Creator not found",
      type: "not_found",
    })
  }

  const m = matches[0]

  return res.status(200).json({
    creator: {
      seller_id: m.seller_id,
      handle: m.creator_handle,
      bio: m.creator_bio,
      niches: m.creator_niches ?? [],
      total_followers: Number(m.creator_total_followers ?? 0),
      audience_geo: m.creator_audience_geo ?? null,
      social_links: m.social_links ?? null,
      verified: !!m.verified,
      featured: !!m.featured,
      rating: m.rating ?? null,
      review_count: Number(m.review_count ?? 0),
    },
  })
}
