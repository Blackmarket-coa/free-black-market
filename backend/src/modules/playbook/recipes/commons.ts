import type { PlaybookRecipe } from "./types"

export const COMMONS: PlaybookRecipe = {
  id: "commons",
  display_name: "Commons",
  social_form: "Multi-stakeholder co-op: producers + workers + consumers + supporters.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "multi_stakeholder",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasVolunteers: true,
    hasMembers: true,
    hasGovernance: true,
    hasSupport: true,
    hasFulfillment: true,
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
    "A co-op where producers, workers, consumers, and supporters all have a seat at the table.",
}
