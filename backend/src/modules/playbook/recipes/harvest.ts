import type { PlaybookRecipe } from "./types"

export const HARVEST: PlaybookRecipe = {
  id: "harvest",
  display_name: "Harvest",
  social_form: "Community garden, collective harvest pool.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "flat",
  default_features: {
    hasProducts: true,
    hasSeasons: true,
    hasVolunteers: true,
    hasDonations: true,
    hasSubscriptions: true,
    hasHarvests: true,
    hasPlots: true,
    hasFarm: true,
    hasSupport: true,
  },
  allowed_listing_types: [
    "physical_product",
    "event",
    "recurring",
    "unique_inventory",
    "bookable",
    "campaign",
  ],
  storefront_blurb_default:
    "A garden you can join. The work is shared, the harvest is shared, the season unfolds together.",
}
