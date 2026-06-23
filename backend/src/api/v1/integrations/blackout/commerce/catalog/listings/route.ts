import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireCommerceApiKey } from "../../../../../../../lib/blackout-commerce-auth"
import { toBlackoutListing } from "../../../../../../../lib/blackout-listing-mapper"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../../../modules/marketplace-listing/models/creator-listing"

const MAX_LIMIT = 100

function decodeCursor(raw: unknown): number {
  if (typeof raw !== "string" || raw.length === 0) return 0
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * §5 GET /v1/catalog/listings?category&q&cursor&limit -> { listings: Listing[] }
 * Served on the Blackout integration surface (API-key auth).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : 25
  const offset = decodeCursor(req.query.cursor)
  const category = typeof req.query.category === "string" ? req.query.category : undefined
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : undefined

  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)

  const filters: Record<string, unknown> = { status: CreatorListingStatus.PUBLISHED }
  if (category) filters.category = category

  // Over-fetch by one to compute the next cursor without a separate count.
  const rows = await service.listCreatorListings(filters, {
    take: limit + 1,
    skip: offset,
    order: { signed_at: "DESC" },
  })

  let page = rows
  if (q) {
    page = page.filter((l) =>
      String(l.title ?? "").toLowerCase().includes(q) ||
      String(l.description ?? "").toLowerCase().includes(q)
    )
  }

  const hasMore = page.length > limit
  const listings = page.slice(0, limit).map(toBlackoutListing)
  const nextCursor = hasMore ? String(offset + limit) : null

  return res.json({ listings, nextCursor })
}
