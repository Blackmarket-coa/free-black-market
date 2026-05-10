import type { PlaybookRecipe } from "./types"

export const KITCHEN: PlaybookRecipe = {
  id: "kitchen",
  display_name: "Kitchen",
  social_form: "Restaurant, commissary, or shared kitchen.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: true,
  member_model: "flat",
  default_features: {
    hasProducts: true,
    hasInventory: true,
    hasMenu: true,
    hasReservations: true,
    hasFulfillment: true,
    hasBookings: true,
  },
  allowed_listing_types: [
    "physical_product",
    "event",
    "recurring",
    "wholesale",
    "bookable",
  ],
  storefront_blurb_default:
    "Cooking that feeds the neighborhood. Pop-ups, takeout, tables when you can get one.",
}
