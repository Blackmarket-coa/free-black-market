import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireCommerceApiKey } from "../../../../../../../../lib/blackout-commerce-auth"
import { resolveSellerPlatformFee } from "../../../../../../../../shared/platform-fee"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../modules/marketplace-listing/service"

/**
 * GET /v1/integrations/blackout/commerce/listings/{id}/fee-quote
 *
 * The platform fee that will actually be charged on this listing's seller,
 * so Blackout can display and persist the real rate rather than assuming the
 * 3% default. Resolution order is the marketplace's own — per-seller override,
 * then vendor plan, then platform default — so a seller on a paid plan quotes
 * lower, which is the whole point.
 *
 * Returns the rate and nothing else. `override_reason`, `plan_code` and
 * `plan_percent` are a vendor's negotiated terms and are not published, the
 * same line `/store/fee-schedule` already draws; this key belongs to Blackout,
 * not to the vendor whose listing is being quoted.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const id = String(req.params.id)
  const listings = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )

  const [listing] = await listings.listCreatorListings({ id })
  if (!listing) {
    return res.status(404).json({ code: "not_found", message: "Listing not found" })
  }

  const { percent, source } = await resolveSellerPlatformFee(
    req.scope,
    listing.seller_id
  )
  return res.json({ feeBps: Math.round(percent * 100), source })
}
