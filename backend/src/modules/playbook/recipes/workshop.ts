import type { PlaybookRecipe } from "./types"

export const WORKSHOP: PlaybookRecipe = {
  id: "workshop",
  display_name: "Workshop",
  social_form: "Worker co-op with sociocratic circles, rotating roles, patronage refunds.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "sociocratic",
  default_features: {
    hasProducts: true,
    hasInventory: true,
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
    "Worker-owned. The people doing the work share the governance and the surplus.",
}
