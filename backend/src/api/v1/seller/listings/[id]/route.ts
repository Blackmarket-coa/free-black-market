import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../modules/marketplace-listing/models/creator-listing"
import {
  isExtensionListing,
  validateExtensionManifest,
} from "../../../../../modules/plugin-registry/manifest"

const slugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

const semverRegex = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i
const httpsUrl = z.string().url().refine((u) => /^https:\/\//.test(u), {
  message: "url must use https://",
})

const PatchSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    manifest: z.record(z.string(), z.unknown()).optional(),
    code_blob_url: httpsUrl.nullable().optional(),
    code_blob_sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
    assets: z
      .array(
        z.object({
          path: z.string().min(1).max(256),
          url: httpsUrl,
          sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        })
      )
      .max(64)
      .nullable()
      .optional(),
    version: z.string().regex(semverRegex).optional(),
    embed_origins: z.array(httpsUrl).max(16).nullable().optional(),
    // Registry namespace claim for extension listings (W3). The schema is
    // .strict(), so the key must be declared here or Forge draft edits 400.
    plugin_slug: z.string().regex(slugRegex).nullable().optional(),
  })
  .strict()

async function getOwnedListing(
  req: MedusaRequest,
  id: string,
  sellerId: string
) {
  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const [listing] = await service.listCreatorListings({ id, seller_id: sellerId })
  return listing ?? null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const listing = await getOwnedListing(req, req.params.id, sellerId)
  if (!listing) {
    return res.status(404).json({ message: "Listing not found", type: "not_found" })
  }
  return res.json({ listing })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const listing = await getOwnedListing(req, req.params.id, sellerId)
  if (!listing) {
    return res.status(404).json({ message: "Listing not found", type: "not_found" })
  }

  if (
    listing.status === CreatorListingStatus.PUBLISHED ||
    listing.status === CreatorListingStatus.SUSPENDED
  ) {
    return res.status(409).json({
      message:
        "Published or suspended listings cannot be edited. Bump the version and create a new draft.",
      type: "invalid_state",
    })
  }

  const parsed = PatchSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid update payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  // Extension listings (W3): validate the manifest the RESULTING listing
  // would carry (patched manifest, or existing one when only plugin_slug
  // changes). Free-form listings without the markers stay untouched.
  const resulting = {
    plugin_slug:
      parsed.data.plugin_slug !== undefined
        ? parsed.data.plugin_slug
        : (listing as { plugin_slug?: string | null }).plugin_slug,
    manifest: parsed.data.manifest ?? (listing.manifest as unknown),
  }
  if (isExtensionListing(resulting)) {
    const validation = validateExtensionManifest(resulting.manifest)
    if (!validation.ok) {
      return res.status(400).json({
        message: "Invalid extension manifest",
        type: "invalid_extension_manifest",
        errors: validation.errors,
      })
    }
  }

  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const updated = await (
    service as unknown as {
      updateCreatorListings(data: Record<string, unknown>): Promise<unknown>
    }
  ).updateCreatorListings({
    id: listing.id,
    ...parsed.data,
  })

  return res.json({ listing: updated })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const listing = await getOwnedListing(req, req.params.id, sellerId)
  if (!listing) {
    return res.status(404).json({ message: "Listing not found", type: "not_found" })
  }

  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  await service.archiveListing(listing.id)
  return res.json({ id: listing.id, status: CreatorListingStatus.ARCHIVED })
}
