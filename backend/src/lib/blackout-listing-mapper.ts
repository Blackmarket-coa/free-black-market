/**
 * Map an FBM `CreatorListing` row onto the §5 `Listing` shape Blackout reads.
 * Blackout accepts camelCase or snake_case; we emit camelCase. Catalog fields
 * (category/priceCents/...) come from the Blackout commerce columns added in
 * Migration20260530AddBlackoutCatalogFields; signed-bundle media is folded into
 * mediaUrls when no explicit media is set.
 */
export function toBlackoutListing(listing: any) {
  const mediaUrls: string[] = Array.isArray(listing.media_urls)
    ? listing.media_urls
    : listing.signed_bundle_url
    ? [listing.signed_bundle_url]
    : []

  return {
    id: listing.id,
    category: listing.category ?? null,
    title: listing.title,
    description: listing.description ?? null,
    priceCents: typeof listing.price_cents === "number" ? listing.price_cents : null,
    currency: listing.currency ?? "USD",
    sellerId: listing.seller_id,
    sellerDisplayName: listing.seller_display_name ?? null,
    mediaUrls,
    entitlementKind: listing.entitlement_kind ?? null,
    tags: Array.isArray(listing.tags) ? listing.tags : [],
    availableSkus: Array.isArray(listing.available_skus) ? listing.available_skus : [],
    slug: listing.slug ?? null,
    status: listing.status ?? null,
  }
}
