import type { PlaybookRecipe } from "./types"

export const SERVICE: PlaybookRecipe = {
  id: "service",
  display_name: "Service",
  // "Time-bank service" read as a platform feature FBM does not run. The HRS
  // rail settles labour between members of a collective (`hawala-ledger/rails.ts`:
  // closed-loop, not cash-convertible) and is never tender for goods — and it is
  // not switched on yet. `docs/CDFI_COOP_ROADMAP.md` §3.10.
  social_form: "Sliding-scale practitioner, scheduled hours, member-to-member time-banking.",
  commission_rate: 0.03,
  allow_sliding_scale: true,
  allow_credits_payout: "opt_in",
  member_model: "solo",
  default_features: {
    hasSubscriptions: true,
    hasSupport: true,
    hasRequests: true,
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
