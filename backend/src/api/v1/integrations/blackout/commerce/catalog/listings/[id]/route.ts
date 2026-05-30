import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireCommerceApiKey } from "../../../../../../../../lib/blackout-commerce-auth"
import { toBlackoutListing } from "../../../../../../../../lib/blackout-listing-mapper"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../modules/marketplace-listing/service"

/**
 * §5 GET /v1/catalog/listings/{id} -> Listing
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const id = String(req.params.id)
  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)

  const [listing] = await service.listCreatorListings({ id })
  if (!listing) {
    return res.status(404).json({ code: "not_found", message: "Listing not found" })
  }
  return res.json(toBlackoutListing(listing))
}
