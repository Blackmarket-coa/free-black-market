import { model } from "@medusajs/framework/utils"

const OnboardingState = model.define("tenancy_onboarding_state", {
  id: model.id().primaryKey(),
  organization_id: model.text(),
  storefront_id: model.text(),
  first_listing_created: model.boolean().default(false),
  payout_configured: model.boolean().default(false),
  first_order_simulated: model.boolean().default(false),
  metadata: model.json().nullable(),
})

export default OnboardingState
