import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { requireCommerceApiKey } from "../../../../../../../lib/blackout-commerce-auth"
import { resolveSellerIdByBlackoutUserId } from "../../../../../../../lib/blackout-identity"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../modules/marketplace-listing/service"
import {
  BLACKOUT_LISTING_CATEGORIES,
  CreatorListingStatus,
} from "../../../../../../../modules/marketplace-listing/models/creator-listing"

type CreatedListing = { id: string; slug: string; status: string }

const slugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

const BodySchema = z
  .object({
    sellerUserId: z.string().min(1).optional(),
    sellerId: z.string().min(1).optional(),
    slug: z.string().regex(slugRegex),
    title: z.string().min(1).max(120),
    description: z.string().max(2000).nullish(),
    category: z.enum(BLACKOUT_LISTING_CATEGORIES).optional(),
    priceCents: z.number().int().nonnegative().optional(),
    currency: z.string().min(3).max(8).optional(),
    entitlementKind: z.string().max(64).optional(),
    availableSkus: z.array(z.string()).max(64).optional(),
    mediaUrls: z.array(z.string().url()).max(32).optional(),
    tags: z.array(z.string()).max(32).optional(),
  })
  .strict()
  .refine((d) => !!(d.sellerUserId || d.sellerId), {
    message: "sellerUserId or sellerId is required",
  })

/**
 * §5 POST /v1/seller/listings -> { id, slug?, status? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid listing draft",
      details: parsed.error.flatten(),
    })
  }
  const d = parsed.data

  let sellerId = d.sellerId ?? null
  if (!sellerId && d.sellerUserId) {
    sellerId = await resolveSellerIdByBlackoutUserId(req.scope, d.sellerUserId)
  }
  if (!sellerId) {
    return res.status(404).json({ code: "not_found", message: "No seller matched the supplied identifier" })
  }

  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)

  // Archived listings release their slug — see Migration20260901ArchivedSlugReuse.
  const existing = (
    await service.listCreatorListings({ seller_id: sellerId, slug: d.slug })
  ).filter((l) => l.status !== CreatorListingStatus.ARCHIVED)
  if (existing.length > 0) {
    return res.status(409).json({ code: "duplicate_slug", message: "A listing with that slug already exists" })
  }

  // The generated `createCreatorListings` input type drifts from this route's
  // historical payload shape; cast through a precise local method signature
  // (no `any`) rather than reshape the payload.
  const created = await (
    service as unknown as {
      createCreatorListings(
        data: Record<string, unknown>
      ): Promise<CreatedListing | CreatedListing[]>
    }
  ).createCreatorListings({
    seller_id: sellerId,
    slug: d.slug,
    title: d.title,
    description: d.description ?? null,
    manifest: {},
    version: "0.0.0",
    status: CreatorListingStatus.DRAFT,
    category: d.category ?? null,
    price_cents: d.priceCents ?? null,
    currency: d.currency ?? null,
    entitlement_kind: d.entitlementKind ?? null,
    available_skus: d.availableSkus ?? null,
    media_urls: d.mediaUrls ?? null,
    tags: d.tags ?? null,
  })
  const listing = Array.isArray(created) ? created[0] : created

  return res.status(201).json({ id: listing.id, slug: listing.slug, status: listing.status })
}
