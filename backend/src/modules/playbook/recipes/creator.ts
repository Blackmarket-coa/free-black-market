import type { PlaybookRecipe } from "./types"

export const CREATOR: PlaybookRecipe = {
  id: "creator",
  display_name: "Creator",
  social_form:
    "Independent creator monetizing an audience — memberships, digital drops, and live shows.",
  commission_rate: 0.03,
  allow_sliding_scale: false,
  allow_credits_payout: "opt_in",
  member_model: "solo",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasSubscriptions: true,
    hasShows: true,
    hasSupport: true,
  },
  allowed_listing_types: [
    "physical_product",
    "digital",
    "event",
    "recurring",
    "unique_inventory",
    "campaign",
  ],
  storefront_blurb_default:
    "A creator sharing their work — memberships, digital goods, and live events.",
}
