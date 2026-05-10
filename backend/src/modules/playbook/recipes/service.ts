import type { PlaybookRecipe } from "./types"

export const SERVICE: PlaybookRecipe = {
  id: "service",
  display_name: "Service",
  social_form: "Time-bank service, sliding-scale practitioner, scheduled hours.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: "opt_in",
  member_model: "solo",
  default_features: {
    hasReservations: true,
    hasSubscriptions: true,
    hasBookings: true,
  },
  allowed_listing_types: [
    "event",
    "digital",
    "recurring",
    "bookable",
  ],
  storefront_blurb_default:
    "Time and skill offered on a schedule. Book a slot; pay what works for you.",
}
