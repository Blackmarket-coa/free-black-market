import type { PlaybookRecipe } from "./types"

export const STALL: PlaybookRecipe = {
  id: "stall",
  display_name: "Stall",
  social_form: "Solo seller. You list, you fulfill, you get paid.",
  commission_rate: 0.03,
  allow_sliding_scale: false,
  allow_credits_payout: "opt_in",
  member_model: "solo",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasFulfillment: true,
  },
  allowed_listing_types: [
    "physical_product",
    "event",
    "digital",
    "recurring",
    "unique_inventory",
    "campaign",
  ],
  storefront_blurb_default:
    "An independent maker bringing their work directly to you.",
}
