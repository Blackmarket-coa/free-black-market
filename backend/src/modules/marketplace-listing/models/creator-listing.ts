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
