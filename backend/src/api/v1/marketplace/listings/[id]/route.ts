import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../modules/marketplace-listing/models/creator-listing"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const [listing] = await service.listCreatorListings({
    id: req.params.id,
    status: CreatorListingStatus.PUBLISHED,
  })
  if (!listing) {
    return res.status(404).json({ message: "Listing not found", type: "not_found" })
  }
  return res.json({
    listing: {
      id: listing.id,
      seller_id: listing.seller_id,
      slug: listing.slug,
      title: listing.title,
      description: listing.description,
      version: listing.version,
      manifest: listing.manifest,
      signed_bundle_url: listing.signed_bundle_url,
      signature_envelope: listing.signature_envelope,
      signed_at: listing.signed_at,
      embed_origins: listing.embed_origins,
    },
  })
}
