import type { PlaybookRecipe } from "./types"

export const HUB: PlaybookRecipe = {
  id: "hub",
  display_name: "Hub",
  social_form: "Federation hub aggregating other vendors under permission grants.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "federation",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasDeliveryZones: true,
    hasSupport: true,
    hasRequests: true,
  },
  allowed_listing_types: [
    "physical_product",
    "event",
    "digital",
    "recurring",
    "wholesale",
    "consignment",
    "unique_inventory",
    "bookable",
    "campaign",
  ],
  storefront_blurb_default:
    "A federation: many vendors, one storefront, governance shared across the network.",
}
