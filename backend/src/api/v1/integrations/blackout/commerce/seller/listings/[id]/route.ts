import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireCommerceApiKey } from "../../../../../../../../lib/blackout-commerce-auth"
import { resolveSellerIdByBlackoutUserId } from "../../../../../../../../lib/blackout-identity"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../modules/marketplace-listing/service"

/**
 * Owner assertion, required — same reasoning as the sibling publish route:
 * `FREEBLACKMARKET_API_KEY` is one shared secret standing in for every
 * creator, so resolving by id alone let any holder hard-delete any seller's
 * listing. Accepted from the query string because DELETE bodies are not
 * reliably forwarded; a body is still honored when one is sent.
 */
function readOwnerAssertion(req: MedusaRequest): {
  sellerUserId?: string
  sellerId?: string
} {
  const q = (req.query ?? {}) as Record<string, unknown>
  const b = (req.body ?? {}) as Record<string, unknown>
  const pick = (key: string): string | undefined => {
    const raw = q[key] ?? b[key]
    return typeof raw === "string" && raw.length > 0 ? raw : undefined
  }
  return { sellerUserId: pick("sellerUserId"), sellerId: pick("sellerId") }
}

/**
 * §5 DELETE /v1/seller/listings/{id} -> { ok }
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const assertion = readOwnerAssertion(req)
  if (!assertion.sellerUserId && !assertion.sellerId) {
    return res.status(400).json({
      code: "bad_request",
      message: "sellerUserId or sellerId is required",
    })
  }

  let sellerId = assertion.sellerId ?? null
  if (!sellerId && assertion.sellerUserId) {
    sellerId = await resolveSellerIdByBlackoutUserId(req.scope, assertion.sellerUserId)
  }
  if (!sellerId) {
    return res
      .status(404)
      .json({ code: "not_found", message: "No seller matched the supplied identifier" })
  }

  const id = String(req.params.id)
  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)

  const [listing] = await service.listCreatorListings({ id })
  if (!listing) {
    return res.status(404).json({ code: "not_found", message: "Listing not found" })
  }
  if (listing.seller_id !== sellerId) {
    return res
      .status(403)
      .json({ code: "forbidden", message: "Listing belongs to another seller" })
  }

  await service.deleteCreatorListings(id)
  return res.json({ ok: true })
}
