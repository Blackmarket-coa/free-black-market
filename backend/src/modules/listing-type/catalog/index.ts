import type { ListingTypeId, ListingTypeDefinition } from "./types"

/**
 * v1 listing-type catalog. Source of truth in code; the `listing_type`
 * table is seeded from this catalog at boot.
 */
export const LISTING_TYPE_CATALOG: Record<ListingTypeId, ListingTypeDefinition> = {
  physical_product: {
    id: "physical_product",
    display_name: "Physical product",
    description:
      "A tangible item the buyer receives via the standard fulfillment pipeline.",
    requires_shipping: true,
    requires_capacity: false,
    requires_recurrence: false,
    requires_escrow: false,
    unique_inventory: false,
  },
  event: {
    id: "event",
    display_name: "Event",
    description:
      "A capacity-bound, time-windowed listing: tickets, classes, farm dinners.",
    requires_shipping: false,
    requires_capacity: true,
    requires_recurrence: false,
    requires_escrow: false,
    unique_inventory: false,
  },
  digital: {
    id: "digital",
    display_name: "Digital",
    description:
      "A downloadable or stream-delivered file. No shipping module engaged.",
    requires_shipping: false,
    requires_capacity: false,
    requires_recurrence: false,
    requires_escrow: false,
    unique_inventory: false,
  },
  recurring: {
    id: "recurring",
    display_name: "Subscription",
    description:
      "A renewing subscription (CSA shares, member-supported zines, sliding-scale memberships, retainers).",
    requires_shipping: false,
    requires_capacity: false,
    requires_recurrence: true,
    requires_escrow: false,
    unique_inventory: false,
  },
  wholesale: {
    id: "wholesale",
    display_name: "Wholesale",
    description:
      "B2B selling with minimum-order quantity and tiered pricing per quantity bracket.",
    requires_shipping: true,
    requires_capacity: false,
    requires_recurrence: false,
    requires_escrow: false,
    unique_inventory: false,
  },
  consignment: {
    id: "consignment",
    display_name: "Consignment",
    description:
      "A vendor sells on behalf of a represented party; revenue split is atomic at order complete.",
    requires_shipping: true,
    requires_capacity: false,
    requires_recurrence: false,
    requires_escrow: false,
    unique_inventory: false,
  },
  unique_inventory: {
    id: "unique_inventory",
    display_name: "One-of-a-kind",
    description:
      "Single-quantity, condition-graded listing for used or unique goods. Cannot be re-listed after sale.",
    requires_shipping: true,
    requires_capacity: false,
    requires_recurrence: false,
    requires_escrow: false,
    unique_inventory: true,
  },
  bookable: {
    id: "bookable",
    display_name: "Bookable slot",
    description:
      "A time-slot-based listing: service appointments, kitchen rentals, educational slots.",
    requires_shipping: false,
    requires_capacity: true,
    requires_recurrence: false,
    requires_escrow: false,
    unique_inventory: false,
  },
  campaign: {
    id: "campaign",
    display_name: "Campaign",
    description:
      "A crowdfunded listing with all-or-nothing settlement and escrow during the funding window.",
    requires_shipping: false,
    requires_capacity: false,
    requires_recurrence: false,
    requires_escrow: true,
    unique_inventory: false,
  },
}

export const LISTING_TYPE_IDS: ListingTypeId[] = Object.keys(
  LISTING_TYPE_CATALOG
) as ListingTypeId[]

export const getListingType = (id: ListingTypeId): ListingTypeDefinition => {
  const def = LISTING_TYPE_CATALOG[id]
  if (!def) {
    throw new Error(`Unknown listing-type id: ${id}`)
  }
  return def
}

export * from "./types"
