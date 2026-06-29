import { model } from "@medusajs/framework/utils"

/**
 * Vendor Type Enum
 *
 * Defines the category of seller for feature gating,
 * UI specialization, and commission logic.
 *
 * Types:
 * - producer: Farms, food producers, ranchers
 * - garden: Community gardens, urban farms
 * - kitchen: Commercial community kitchens, shared-use kitchens
 * - maker: Artisans, crafters, cottage food producers
 * - restaurant: Restaurants, ghost kitchens, food trucks
 * - mutual_aid: Mutual aid networks, community organizations
 *
 * IMPORTANT: These values MUST match the PostgreSQL enum `vendor_type_enum`.
 * See Migration20260114FixVendorTypeEnum for the canonical enum definition.
 */
export enum VendorType {
  PRODUCER = "producer",
  GARDEN = "garden",
  KITCHEN = "kitchen",
  MAKER = "maker",
  RESTAURANT = "restaurant",
  MUTUAL_AID = "mutual_aid",
  CREATOR = "creator",
}

/**
 * Creator profile fields used by the creator-monetization platform.
 * Only meaningful when `vendor_type === CREATOR`.
 */
export interface CreatorAudienceGeo {
  // ISO-3166-1 alpha-2 country code -> share (0..1) of the creator's audience
  [countryCode: string]: number
}

/**
 * Social Media Links Interface
 * Stores URLs for various social media platforms
 */
export interface SocialLinks {
  instagram?: string
  facebook?: string
  twitter?: string
  tiktok?: string
  youtube?: string
  linkedin?: string
  pinterest?: string
}

/**
 * External Storefront Links Interface
 * Stores URLs for other platforms where the vendor sells
 */
export interface StorefrontLinks {
  website?: string
  etsy?: string
  amazon?: string
  shopify?: string
  ebay?: string
  farmers_market?: string
  other?: { name: string; url: string }[]
}

/**
 * Seller Metadata - Extension for MercurJS Seller
 *
 * Since we can't modify the @mercurjs/b2c-core seller model directly,
 * we create a linked metadata table that extends seller capabilities.
 *
 * This table is linked 1:1 with the seller table via seller_id.
 *
 * RELATIONSHIP WITH PRODUCER MODULE:
 * ----------------------------------
 * Both seller_metadata and producer have some overlapping fields
 * (certifications, social_links). Here's the distinction:
 *
 * seller_metadata (this model):
 *   - INTERNAL/ADMIN data for ALL seller types
 *   - vendor_type classification (producer, garden, maker, etc.)
 *   - Business info (tax, registration numbers)
 *   - Platform status (verified, featured, rating)
 *   - Type-specific operational fields (cuisine_types, service_types)
 *
 * producer (separate module):
 *   - CUSTOMER-FACING profile for PRODUCER type sellers only
 *   - Farm story/narrative content
 *   - Location info (region, coordinates)
 *   - Farm details (size, year established)
 *   - Public gallery/media
 *   - Growing practices and certifications for transparency
 *
 * In summary:
 *   seller_metadata = operational data for backend/admin use
 *   producer = marketing/trust data for customer-facing storefront
 *
 * A producer-type seller will have BOTH:
 *   - seller_metadata (with vendor_type="producer")
 *   - producer profile (with customer-facing farm story)
 */
const SellerMetadata = model.define("seller_metadata", {
  id: model.id().primaryKey(),
  
  // Link to MercurJS seller (will be linked via module link)
  seller_id: model.text().unique(),
  
  // Vendor type classification
  vendor_type: model.enum(Object.values(VendorType)).default(VendorType.PRODUCER),
  
  // Extended business information
  business_registration_number: model.text().nullable(),
  tax_classification: model.text().nullable(),
  
  // Social media links (JSON object with platform keys)
  social_links: model.json().nullable(), // SocialLinks type
  
  // External storefront links (where else they sell)
  storefront_links: model.json().nullable(), // StorefrontLinks type
  
  // Primary website URL (quick access)
  website_url: model.text().nullable(),
  
  // Agricultural-specific fields (used when vendor_type = FARM)
  farm_practices: model.json().nullable(), // organic, regenerative, conventional, etc.
  certifications: model.json().nullable(), // USDA Organic, Fair Trade, etc.
  growing_region: model.text().nullable(),
  
  // Restaurant-specific fields (used when vendor_type = RESTAURANT)
  cuisine_types: model.json().nullable(),
  service_types: model.json().nullable(), // dine-in, takeout, delivery, catering
  
  // General extended fields
  featured: model.boolean().default(false),
  verified: model.boolean().default(false),
  rating: model.float().nullable(),
  review_count: model.number().default(0),
  
  // Vendor-selected dashboard extensions (feature keys)
  enabled_extensions: model.json().nullable(),

  // Vendor-selected embed surfaces for the FBM Connect embed. Array of enabled
  // keys (see EMBED_FEATURE_KEYS in shared/website-config). Null ⇒ all surfaces
  // enabled (default-on), so existing embeds are unaffected.
  embed_features: model.json().nullable(),

  // Creator-specific fields (used when vendor_type === CREATOR)
  creator_handle: model.text().nullable(),
  creator_bio: model.text().nullable(),
  creator_niches: model.json().nullable(), // string[]
  creator_total_followers: model.number().default(0),
  creator_audience_geo: model.json().nullable(), // CreatorAudienceGeo

  // Matrix MXID — canonical identity per AGGRESSIVE_OPERATIONS_GUIDE.md §2.1.
  // Nullable while existing vendors are backfilled; uniqueness enforced via
  // a partial unique index in Migration202607AddMxidToSellerMetadata.
  mxid: model.text().nullable(),

  // Blackout user id (the OAuth `sub`) captured when the vendor links their
  // Blackout account. Distinct from `mxid`: this is the value Blackout keys
  // entitlement grants and webhook `userId` on. Nullable until linked.
  blackout_user_id: model.text().nullable(),

  // ── FBM Sites — "commerce anywhere" (see Migration20260620AddWebsiteFields) ──
  // Mode 1 (Connect): bare hostnames where the vendor embeds the Connect SDK.
  connect_domains: model.json().nullable(), // string[]
  // Mode 2 (Launch): provisioning lifecycle of an FBM-hosted standalone site.
  // One of: "none" | "provisioning" | "live" | "failed".
  site_status: model.text().default("none"),
  // Public URL of the launched site once it is live.
  site_url: model.text().nullable(),
  // GitHub repository (org/name) backing the launched site.
  site_repo: model.text().nullable(),

  // Metadata for additional extensions
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["vendor_type"],
      name: "IDX_seller_metadata_vendor_type",
    },
    {
      on: ["featured"],
      name: "IDX_seller_metadata_featured",
    },
  ])

export default SellerMetadata
