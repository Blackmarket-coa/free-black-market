import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_LISTING_MODULE } from "../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../modules/marketplace-listing/models/creator-listing"

const MAX_LIMIT = 100

function parseInt32(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== "string") return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(n, max)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = parseInt32(req.query.limit, 25, MAX_LIMIT)
  const offset = parseInt32(req.query.offset, 0, 10_000)
  const seller_id =
    typeof req.query.seller_id === "string" ? req.query.seller_id : undefined

  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )

  const filters: Record<string, unknown> = { status: CreatorListingStatus.PUBLISHED }
  if (seller_id) filters.seller_id = seller_id

  const listings = await service.listCreatorListings(filters, {
    take: limit,
    skip: offset,
    order: { signed_at: "DESC" },
  })

  return res.json({
    listings: listings.map(toPublicListing),
    limit,
    offset,
  })
}

function toPublicListing(listing: any) {
  return {
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
  }
}
