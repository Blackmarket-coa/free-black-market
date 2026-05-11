import type { PlaybookRecipe } from "./types"

export const GROVE: PlaybookRecipe = {
  id: "grove",
  display_name: "Grove",
  social_form: "Mutual-aid co-op with internal scrip and sliding scale.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "flat",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasVolunteers: true,
    hasDonations: true,
    hasSupport: true,
    hasRequests: true,
  },
  allowed_listing_types: [
    "physical_product",
    "event",
    "recurring",
    "unique_inventory",
    "bookable",
  ],
  storefront_blurb_default:
    "Mutual-aid commerce: take what you need, give what you can, decide together.",
}
