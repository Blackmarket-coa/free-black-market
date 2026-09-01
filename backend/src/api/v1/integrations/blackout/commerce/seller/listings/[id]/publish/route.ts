import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { requireCommerceApiKey } from "../../../../../../../../../lib/blackout-commerce-auth"
import { resolveSellerIdByBlackoutUserId } from "../../../../../../../../../lib/blackout-identity"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../../../../../modules/marketplace-listing/models/creator-listing"

/**
 * Owner assertion, required. `FREEBLACKMARKET_API_KEY` is a single shared
 * secret held by the Blackout backend on behalf of EVERY creator, so the key
 * authenticates the caller as "Blackout" and says nothing about which seller
 * is acting. Resolving the listing by id alone therefore let any holder of
 * that key publish — or effectively un-suspend — any seller's listing.
 *
 * The caller must now name the seller it is acting for, exactly as the sibling
 * create route already does, and the listing must belong to them.
 */
const BodySchema = z
  .object({
    sellerUserId: z.string().min(1).optional(),
    sellerId: z.string().min(1).optional(),
  })
  .strict()
  .refine((d) => !!(d.sellerUserId || d.sellerId), {
    message: "sellerUserId or sellerId is required",
  })

/**
 * §5 POST /v1/seller/listings/{id}/publish -> { id, slug?, status? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid publish request",
      details: parsed.error.flatten(),
    })
  }

  let sellerId = parsed.data.sellerId ?? null
  if (!sellerId && parsed.data.sellerUserId) {
    sellerId = await resolveSellerIdByBlackoutUserId(req.scope, parsed.data.sellerUserId)
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
  // Suspension is an enforcement action; publishing must not undo it.
  if (listing.status === CreatorListingStatus.SUSPENDED) {
    return res
      .status(409)
      .json({ code: "listing_suspended", message: "A suspended listing cannot be published" })
  }

  const [updated] = await service.updateCreatorListings([
    { id, status: CreatorListingStatus.PUBLISHED, signed_at: new Date() },
  ])

  return res.json({ id: updated.id, slug: updated.slug, status: updated.status })
}
