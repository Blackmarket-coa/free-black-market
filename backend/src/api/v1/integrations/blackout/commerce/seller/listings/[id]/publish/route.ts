import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireCommerceApiKey } from "../../../../../../../../../lib/blackout-commerce-auth"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../../../../../modules/marketplace-listing/models/creator-listing"

/**
 * §5 POST /v1/seller/listings/{id}/publish -> { id, slug?, status? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const id = String(req.params.id)
  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)

  const [listing] = await service.listCreatorListings({ id })
  if (!listing) {
    return res.status(404).json({ code: "not_found", message: "Listing not found" })
  }

  const [updated] = await (service as any).updateCreatorListings([
    { id, status: CreatorListingStatus.PUBLISHED, signed_at: new Date() },
  ])

  return res.json({ id: updated.id, slug: updated.slug, status: updated.status })
}
