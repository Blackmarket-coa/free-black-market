import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireCommerceApiKey } from "../../../../../../../../lib/blackout-commerce-auth"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../modules/marketplace-listing/service"

/**
 * §5 DELETE /v1/seller/listings/{id} -> { ok }
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const id = String(req.params.id)
  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)

  const [listing] = await service.listCreatorListings({ id })
  if (!listing) {
    return res.status(404).json({ code: "not_found", message: "Listing not found" })
  }

  await service.deleteCreatorListings(id)
  return res.json({ ok: true })
}
