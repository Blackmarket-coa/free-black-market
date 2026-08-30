import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../../modules/marketplace-listing/models/creator-listing"
import { MARKETPLACE_SIGNING_MODULE } from "../../../../../../modules/marketplace-signing"
import type PluginSigningService from "../../../../../../modules/marketplace-signing/service"
import {
  canonicalJson,
  sha256,
} from "../../../../../../modules/marketplace-signing/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../../modules/plugin-registry/service"
import { PluginRegistryConflictError } from "../../../../../../modules/plugin-registry/service"
import {
  buildDistributionManifest,
  isExtensionListing,
  mapArtifactKindToCategory,
  resolvePluginSlug,
  validateExtensionManifest,
  type ExtensionManifest,
} from "../../../../../../modules/plugin-registry/manifest"
import { PluginCategory } from "../../../../../../modules/plugin-registry/models/plugin-listing"
import { emitBlackoutEvent } from "../../../../../../lib/blackout-emit"
import { resolveSellerBlackoutUserId } from "../../../../../../lib/blackout-identity"

/**
 * Publish a creator listing: sign it, and — when it is an extension listing
 * (W3, docs/contracts/extension-manifest.md) — bridge it into the plugin
 * registry (catalog upsert + immutable plugin_version row + Blackout-format
 * distribution envelope).
 *
 * Ordering is load-bearing: every new extension guard runs BEFORE
 * beginPublish so validation failures leave the listing in DRAFT (the
 * pre-existing revert only covers signing failures). Non-extension listings
 * take the byte-equivalent legacy path — the registry service is not even
 * resolved for them.
 *
 * Not a DB transaction: the registry write compensates internally, and a
 * crash between it and markPublished converges on the retried publish
 * because recordVersion is idempotent for byte-identical artifacts
 * (marketplace convention — same posture as the checkout bridge).
 */
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

  const manifest = (listing.manifest ?? {}) as Record<string, unknown>
  const isExtension = isExtensionListing({
    plugin_slug: (listing as { plugin_slug?: string | null }).plugin_slug,
    manifest,
  })

  // --- extension pre-flight (all before beginPublish; failures stay DRAFT) --
  let extensionManifest: ExtensionManifest | null = null
  let pluginSlug: string | null = null
  let registry: PluginRegistryService | null = null
  if (isExtension) {
    pluginSlug = resolvePluginSlug({
      pluginSlug: (listing as { plugin_slug?: string | null }).plugin_slug,
      listingSlug: listing.slug,
    })
    const validation = validateExtensionManifest(manifest, {
      forPublish: true,
      listingVersion: listing.version,
      listingSlug: listing.slug,
      pluginSlug,
    })
    if (!validation.ok) {
      return res.status(400).json({
        message: "Extension manifest failed publish validation",
        type: "invalid_extension_manifest",
        errors: validation.errors,
      })
    }
    extensionManifest = validation.manifest

    registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)
    const existing = await registry.getBySlug(pluginSlug!)
    if (existing && existing.author_seller_id !== sellerId) {
      return res.status(409).json({
        message: `Plugin slug "${pluginSlug}" is owned by another author`,
        type: "plugin_slug_taken",
      })
    }
    const versions = await registry.listVersions(pluginSlug!, { includeYanked: true })
    const dupe = versions.find((v) => v.version === listing.version)
    if (dupe && (dupe.code_sha256 ?? null) !== (listing.code_blob_sha256 ?? null)) {
      return res.status(409).json({
        message: `Version ${listing.version} of "${pluginSlug}" is already published with a different artifact`,
        type: "version_already_published",
      })
    }
  }

  // manifest_plugin extensions carry no code — the signature covers the
  // manifest and the bundle hash falls back to the declarative payload hash.
  const isManifestOnly = extensionManifest?.artifactKind === "manifest_plugin"
  if ((!isExtension || !isManifestOnly) && (!listing.code_blob_url || !listing.code_blob_sha256)) {
    return res.status(400).json({
      message: "Cannot publish: code_blob_url and code_blob_sha256 are required",
      type: "missing_code_blob",
    })
  }

  const bundleSha256 =
    listing.code_blob_sha256 ??
    (typeof extensionManifest?.sha256 === "string"
      ? extensionManifest.sha256
      : sha256(canonicalJson(manifest)))

  const assets = (listing.assets as Array<{ path: string; sha256: string }> | null) ?? []
  const assetHashes: Record<string, string> = {}
  for (const a of assets) {
    assetHashes[a.path] = a.sha256
  }

  await listingService.beginPublish(listing.id)

  const revertToDraft = () =>
    listingService.updateCreatorListings({
      id: listing.id,
      status: CreatorListingStatus.DRAFT,
    })

  let envelope
  try {
    envelope = signingService.sign({
      manifest: {
        id: typeof manifest.id === "string" ? manifest.id : listing.slug,
        version: listing.version,
        ...manifest,
      },
      codeSha256: bundleSha256,
      assetHashes,
    })
  } catch (err) {
    await revertToDraft()
    const message = err instanceof Error ? err.message : "Signing failed"
    return res.status(500).json({ message, type: "signing_failed" })
  }

  // --- registry bridge (extension listings only) ---------------------------
  let pluginInfo: { slug: string; version: string } | null = null
  let manifestUrl: string | null = null
  if (isExtension && extensionManifest && pluginSlug && registry) {
    const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https"
    const host = req.headers["x-forwarded-host"] || req.headers.host
    const baseUrl = (
      process.env.FREEBLACKMARKET_BASE_URL ||
      process.env.BACKEND_URL ||
      `${protocol}://${host}`
    ).replace(/\/$/, "")
    manifestUrl = `${baseUrl}/store/plugins/${pluginSlug}/manifest`

    const distManifest = buildDistributionManifest({
      authored: extensionManifest,
      listingId: listing.id,
      publicSlug: pluginSlug,
      codeSha256: bundleSha256,
    })

    let blackoutEnvelope
    try {
      blackoutEnvelope = signingService.signBlackoutEnvelope({
        manifest: distManifest as { id: string; version: string },
        bundleSha256,
      })
    } catch (err) {
      await revertToDraft()
      const message = err instanceof Error ? err.message : "Signing failed"
      return res.status(500).json({ message, type: "signing_failed" })
    }

    const fbm = (extensionManifest.fbm ?? {}) as {
      minHostVersion?: string
      maxHostVersion?: string
      category?: PluginCategory
    }
    try {
      await registry.publishExtensionVersion({
        slug: pluginSlug,
        name: listing.title,
        category: mapArtifactKindToCategory(extensionManifest.artifactKind, fbm.category),
        description:
          listing.description ?? extensionManifest.description ?? listing.title,
        authorSellerId: sellerId,
        version: listing.version,
        minHostVersion: fbm.minHostVersion ?? null,
        maxHostVersion: fbm.maxHostVersion ?? null,
        manifestUrl,
        version_record: {
          manifest: distManifest as unknown as Record<string, unknown>,
          manifest_url: manifestUrl,
          signed_bundle_url: listing.code_blob_url ?? manifestUrl,
          signature_envelope: blackoutEnvelope as unknown as Record<string, unknown>,
          signing_key_id: blackoutEnvelope.keyId,
          code_sha256: bundleSha256,
          source_listing_id: listing.id,
        },
      })
    } catch (err) {
      await revertToDraft()
      if (err instanceof PluginRegistryConflictError) {
        return res.status(409).json({ message: err.message, type: err.type })
      }
      const message = err instanceof Error ? err.message : "Registry publish failed"
      return res.status(502).json({ message, type: "registry_publish_failed" })
    }
    pluginInfo = { slug: pluginSlug, version: listing.version }
  }

  const signedBundleUrl = listing.code_blob_url ?? manifestUrl ?? ""

  const updated = await listingService.markPublished(listing.id, {
    signed_bundle_url: signedBundleUrl,
    signature_envelope: envelope as unknown as Record<string, unknown>,
    signing_key_id: envelope.keyId,
  })

  if (pluginInfo) {
    // The two long-dead columns become live: record what this listing
    // published into the registry.
    await listingService.updateCreatorListings({
      id: listing.id,
      plugin_slug: pluginInfo.slug,
      plugin_version: pluginInfo.version,
    })
  }

  await webhooksService.dispatch("listing.signed_bundle.published", sellerId, {
    listing_id: listing.id,
    slug: listing.slug,
    version: listing.version,
    signed_bundle_url: signedBundleUrl,
    signature_envelope: envelope,
    plugin: pluginInfo,
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

  return res.json({ listing: updated, envelope, plugin: pluginInfo })
}
