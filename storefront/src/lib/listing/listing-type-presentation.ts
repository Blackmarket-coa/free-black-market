/**
 * Per-listing-type product presentation descriptors.
 *
 * Each backend listing-type catalog id (see
 * `backend/src/modules/listing-type/catalog`) maps to a small descriptor
 * that tells the product detail page how to present the listing: badge
 * label, tagline, whether shipping/quantity chrome applies, and which
 * type-specific detail slot (if any) to render.
 *
 * Pure module, no I/O. Callers fetch the product's catalog id separately
 * (via `getProductListingType()`) and feed it in here. Unknown or missing
 * ids fall back to the `physical_product` descriptor so an unlinked
 * product renders exactly as it did before listing types existed.
 */

export type ListingTypeCatalogId =
  | "physical_product"
  | "event"
  | "digital"
  | "recurring"
  | "wholesale"
  | "consignment"
  | "unique_inventory"
  | "bookable"
  | "campaign"

/**
 * Type-specific detail sections. `"event"` is an extension point: the
 * detail page renders a placeholder slot there today, and the ticket
 * purchase panel mounts into it later.
 */
export type ListingTypeDetailSlot =
  | "none"
  | "event"
  | "booking"
  | "subscription"
  | "digital"

export type ListingTypePresentation = {
  catalogId: ListingTypeCatalogId
  badgeLabel: string
  tagline: string
  /** Whether the shipping & returns section applies to this listing. */
  showShipping: boolean
  /** False when quantity is locked to 1 (one-of-a-kind listings). */
  showQuantity: boolean
  detailSlot: ListingTypeDetailSlot
}

export const LISTING_TYPE_PRESENTATIONS: Record<
  ListingTypeCatalogId,
  ListingTypePresentation
> = {
  physical_product: {
    catalogId: "physical_product",
    badgeLabel: "Physical product",
    tagline: "A tangible item, shipped to you by the seller.",
    showShipping: true,
    showQuantity: true,
    detailSlot: "none",
  },
  event: {
    catalogId: "event",
    badgeLabel: "Event",
    tagline: "A ticketed, time-windowed happening with limited capacity.",
    showShipping: false,
    showQuantity: true,
    detailSlot: "event",
  },
  digital: {
    catalogId: "digital",
    badgeLabel: "Digital",
    tagline: "Delivered instantly after purchase — nothing ships.",
    showShipping: false,
    showQuantity: true,
    detailSlot: "digital",
  },
  recurring: {
    catalogId: "recurring",
    badgeLabel: "Subscription",
    tagline: "Renews automatically on a recurring cadence.",
    showShipping: false,
    showQuantity: true,
    detailSlot: "subscription",
  },
  wholesale: {
    catalogId: "wholesale",
    badgeLabel: "Wholesale",
    tagline: "B2B pricing with minimum-order quantities.",
    showShipping: true,
    showQuantity: true,
    detailSlot: "none",
  },
  consignment: {
    catalogId: "consignment",
    badgeLabel: "Consignment",
    tagline: "Sold by this vendor on behalf of the maker.",
    showShipping: true,
    showQuantity: true,
    detailSlot: "none",
  },
  unique_inventory: {
    catalogId: "unique_inventory",
    badgeLabel: "One of a kind",
    tagline: "A single-quantity item — once it sells, it's gone.",
    showShipping: true,
    showQuantity: false,
    detailSlot: "none",
  },
  bookable: {
    catalogId: "bookable",
    badgeLabel: "Bookable",
    tagline: "Reserved as a time slot with the seller.",
    showShipping: false,
    showQuantity: true,
    detailSlot: "booking",
  },
  campaign: {
    catalogId: "campaign",
    badgeLabel: "Campaign",
    tagline: "Crowdfunded — settles only if the funding goal is met.",
    showShipping: false,
    showQuantity: true,
    detailSlot: "none",
  },
}

const isKnownCatalogId = (id: string): id is ListingTypeCatalogId =>
  id in LISTING_TYPE_PRESENTATIONS

/**
 * Resolve a catalog id (possibly null/unknown — e.g. a product with no
 * listing-type link, or a catalog id shipped after this storefront build)
 * to its presentation descriptor. Falls back to `physical_product`.
 */
export function selectListingTypePresentation(
  catalogId: string | null | undefined
): ListingTypePresentation {
  if (catalogId && isKnownCatalogId(catalogId)) {
    return LISTING_TYPE_PRESENTATIONS[catalogId]
  }
  return LISTING_TYPE_PRESENTATIONS.physical_product
}
