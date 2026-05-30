import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../../modules/marketplace-listing/models/creator-listing"
import { MARKETPLACE_SIGNING_MODULE } from "../../../../../../modules/marketplace-signing"
import type PluginSigningService from "../../../../../../modules/marketplace-signing/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
import { emitBlackoutEvent } from "../../../../../../lib/blackout-emit"
import { resolveSellerBlackoutUserId } from "../../../../../../lib/blackout-identity"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const listingService = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const signingService = req.scope.resolve<PluginSigningService>(
    MARKETPLACE_SIGNING_MODULE
  )
  const webhooksService = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  const [listing] = await listingService.listCreatorListings({
    id: req.params.id,
    seller_id: sellerId,
  })
  if (!listing) {
    return res.status(404).json({ message: "Listing not found", type: "not_found" })
  }

  if (listing.status === CreatorListingStatus.SUSPENDED) {
    return res.status(409).json({
      message: "Suspended listings cannot be published",
      type: "invalid_state",
    })
  }

  if (!listing.code_blob_url || !listing.code_blob_sha256) {
    return res.status(400).json({
      message: "Cannot publish: code_blob_url and code_blob_sha256 are required",
      type: "missing_code_blob",
    })
  }

  const manifest = (listing.manifest ?? {}) as Record<string, unknown>
  const assets = (listing.assets as Array<{ path: string; sha256: string }> | null) ?? []
  const assetHashes: Record<string, string> = {}
  for (const a of assets) {
    assetHashes[a.path] = a.sha256
  }

  await listingService.beginPublish(listing.id)

  let envelope
  try {
    envelope = signingService.sign({
      manifest: {
        id: typeof manifest.id === "string" ? manifest.id : listing.slug,
        version: listing.version,
        ...manifest,
      },
      codeSha256: listing.code_blob_sha256,
      assetHashes,
    })
  } catch (err) {
    await listingService.updateCreatorListings({
      id: listing.id,
      status: CreatorListingStatus.DRAFT,
    })
    const message = err instanceof Error ? err.message : "Signing failed"
    return res.status(500).json({ message, type: "signing_failed" })
  }

  const signedBundleUrl = listing.code_blob_url

  const updated = await listingService.markPublished(listing.id, {
    signed_bundle_url: signedBundleUrl,
    signature_envelope: envelope as unknown as Record<string, unknown>,
    signing_key_id: envelope.keyId,
  })

  await webhooksService.dispatch("listing.signed_bundle.published", sellerId, {
    listing_id: listing.id,
    slug: listing.slug,
    version: listing.version,
    signed_bundle_url: signedBundleUrl,
    signature_envelope: envelope,
  })

  // §2 lifecycle: mirror onto the global Blackout channel. userId is the
  // vendor's Blackout id; skip if the vendor hasn't linked their account.
  const blackoutUserId = await resolveSellerBlackoutUserId(req.scope, sellerId)
  if (blackoutUserId) {
    await emitBlackoutEvent(
      req.scope,
      "listing.signed_bundle.published",
      { userId: blackoutUserId, providerListingId: listing.id },
      {
        eventId: `listing.signed_bundle.published:${listing.id}:${listing.version}`,
        metadata: { slug: listing.slug, version: listing.version },
      }
    )
  }

  return res.json({ listing: updated, envelope })
}
