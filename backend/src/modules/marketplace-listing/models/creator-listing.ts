import { model } from "@medusajs/framework/utils"

export enum CreatorListingStatus {
  DRAFT = "draft",
  SIGNING = "signing",
  PUBLISHED = "published",
  ARCHIVED = "archived",
  SUSPENDED = "suspended",
}

export interface CreatorListingAsset {
  path: string
  url: string
  sha256: string
}

/**
 * Blackout marketplace categories (§5). A listing's `category` must be one of
 * these for the commerce catalog API to surface it to Blackout.
 */
export const BLACKOUT_LISTING_CATEGORIES = [
  "emoji-sticker",
  "meme-asset",
  "stego-software",
  "plugin-curated",
  "subscription",
  "profile-cosmetic",
  "audio-pack",
  "community-template",
  "creator-asset",
  "security-tool",
  "ai-automation",
] as const

export type BlackoutListingCategory = (typeof BLACKOUT_LISTING_CATEGORIES)[number]

export interface CreatorListingSignatureEnvelope {
  keyId: string
  alg: "ed25519"
  manifestHash: string
  codeHash: string
  assetHashes: Record<string, string>
  signedAt: string
  signature: string
}

const CreatorListing = model
  .define("creator_listing", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    slug: model.text(),
    title: model.text(),
    description: model.text().nullable(),

    manifest: model.json(),
    code_blob_url: model.text().nullable(),
    code_blob_sha256: model.text().nullable(),
    assets: model.json().nullable(),

    version: model.text(),
    status: model
      .enum(Object.values(CreatorListingStatus))
      .default(CreatorListingStatus.DRAFT),

    signed_bundle_url: model.text().nullable(),
    signature_envelope: model.json().nullable(),
    signed_at: model.dateTime().nullable(),
    signing_key_id: model.text().nullable(),

    embed_origins: model.json().nullable(),

    // === BMC marketplace categories (plugin / theme / emoji-pack / access-pass) ===
    plugin_slug: model.text().nullable(),
    plugin_version: model.text().nullable(),
    plugin_repo_url: model.text().nullable(),
    theme_slug: model.text().nullable(),
    emoji_pack_slug: model.text().nullable(),
    /**
     * Compatibility map e.g. { blackout: ">=1.0", fbm: ">=2.12" }.
     */
    compatible_with: model.json().nullable(),
    /**
     * Distinct from `seller_id` to support white-label distribution where the
     * listing seller is not the developer earning the plugin-developer split.
     */
    developer_seller_id: model.text().nullable(),

    // === Blackout commerce catalog fields (§5) ===
    // CreatorListing is signed-bundle shaped; these add the priced-catalog
    // surface Blackout reads (priceCents/category/availableSkus/...). Nullable
    // so existing signed-bundle listings are unaffected.
    category: model.text().nullable(), // one of BLACKOUT_LISTING_CATEGORIES
    price_cents: model.number().nullable(),
    currency: model.text().nullable(),
    entitlement_kind: model.text().nullable(),
    available_skus: model.json().nullable(), // string[]
    media_urls: model.json().nullable(), // string[]
    tags: model.json().nullable(), // string[]
    // `features.*` entitlement keys this listing grants when purchased. For a
    // subscription-tier listing this is the whole tier bundle; for an
    // individual item it is usually one key (empty for pure artifact goods).
    // Bridges the priced catalog to Blackout's `features.*` entitlement system.
    feature_keys: model.json().nullable(), // string[]

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["seller_id"],
      name: "IDX_creator_listing_seller_id",
    },
    {
      on: ["status"],
      name: "IDX_creator_listing_status",
    },
    {
      on: ["seller_id", "slug"],
      name: "UQ_creator_listing_seller_slug",
      unique: true,
    },
  ])

export default CreatorListing
