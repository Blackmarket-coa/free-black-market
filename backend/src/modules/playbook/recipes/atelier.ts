import type { PlaybookRecipe } from "./types"

export const ATELIER: PlaybookRecipe = {
  id: "atelier",
  display_name: "Atelier",
  social_form: "Small affinity group, 2–12 members, flat consensus.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "flat",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasSupport: true,
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
    "A small group of makers working together, sharing the workshop and the surplus.",
}
