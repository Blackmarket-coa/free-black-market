import type { PlaybookRecipe } from "./types"

export const CYCLE: PlaybookRecipe = {
  id: "cycle",
  display_name: "Cycle",
  social_form: "CSA / order-cycle farm. Time-bounded selling, share-based listings.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "flat",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasSeasons: true,
    hasSubscriptions: true,
    hasHarvests: true,
    hasFarm: true,
    hasSupport: true,
  },
  allowed_listing_types: [
    "physical_product",
    "event",
    "recurring",
    "wholesale",
    "bookable",
    "campaign",
  ],
  storefront_blurb_default:
    "A farm running seasonal shares. Subscribe for the harvest; the surplus comes through together.",
}
