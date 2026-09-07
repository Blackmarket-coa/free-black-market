import type { PlaybookRecipe } from "./types"

export const GROVE: PlaybookRecipe = {
  id: "grove",
  display_name: "Grove",
  // "Internal scrip" named the same unlit hours rail as Service does, and
  // implied a currency members can spend here. Hours settle work between
  // members; they are never tender for goods. `docs/CDFI_COOP_ROADMAP.md` §3.10.
  social_form: "Mutual-aid co-op with sliding scale and member-to-member hour-sharing.",
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
