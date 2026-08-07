import { model } from "@medusajs/framework/utils"

/**
 * Sprint A wizard step machine. Mirrors `FEATURE_BUILD_PLAN.md` A1-A10:
 *  signup -> step_1 (selling type) -> step_2 (listing) -> step_3 (delivery)
 *  -> step_4 (publish) -> published
 *
 * `cottage_food` is a **conditional** step sitting between step_3 and step_4,
 * traversed only by sellers who said they make their product in a home
 * kitchen. Everyone else goes step_3 -> step_4 as before and never sees it.
 * The wizard is a progress marker rather than a state machine —
 * `advanceWizardStep` just records the furthest step reached — so an optional
 * branch costs nothing here, but funnel readings should be taken per-cohort:
 * `cottage_food` will always be a small slice of total sellers.
 */
export enum OnboardingWizardStep {
  SIGNUP = "signup",
  STEP_1 = "step_1",
  STEP_2 = "step_2",
  STEP_3 = "step_3",
  COTTAGE_FOOD = "cottage_food",
  STEP_4 = "step_4",
  PUBLISHED = "published",
}

export enum OnboardingSellingType {
  PHYSICAL = "physical",
  DIGITAL = "digital",
  SERVICE = "service",
  EVENT_CLASS = "event_class",
}

const OnboardingState = model.define("tenancy_onboarding_state", {
  id: model.id().primaryKey(),
  organization_id: model.text(),
  storefront_id: model.text(),
  first_listing_created: model.boolean().default(false),
  payout_configured: model.boolean().default(false),
  first_order_simulated: model.boolean().default(false),

  // Sprint A wizard fields
  seller_id: model.text().nullable(),
  selling_type: model.enum(Object.values(OnboardingSellingType)).nullable(),
  wizard_step: model
    .enum(Object.values(OnboardingWizardStep))
    .default(OnboardingWizardStep.SIGNUP),
  /**
   * ISO timestamps keyed by wizard_step value. Drives funnel telemetry
   * (signup → step_1 → … → published) without a separate events table.
   */
  wizard_step_completed_at: model.json().nullable(),
  wizard_started_at: model.dateTime().nullable(),
  first_published_listing_id: model.text().nullable(),
  first_published_at: model.dateTime().nullable(),
  /**
   * Sprint A friction control: defer Stripe Connect onboarding until the
   * vendor's first sale. Vendors can publish without this configured.
   */
  payout_deferred_until_first_sale: model.boolean().default(true),

  /**
   * True when the seller went through the 60s "quick path" onboarding
   * variant rather than the 5-step wizard. Drives the redirect logic in
   * vendor-panel/src/routes/onboarding/onboarding.tsx and lets us measure
   * funnel uplift.
   */
  quick_path_used: model.boolean().default(false),
  /**
   * Captured at signup when the seller arrived via an affiliate link. Set
   * by the seller-created subscriber when `_fbm_aff` cookie is present.
   * Feeds Slice B's referral chain.
   */
  referred_by_seller_id: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default OnboardingState
