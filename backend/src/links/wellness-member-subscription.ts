import { defineLink } from "@medusajs/framework/utils"
import SubscriptionModule from "../modules/subscription"
import WellnessModule from "../modules/wellness"
import { hasLinkable } from "./utils/load-seller-module"

/**
 * Link a wellness member to its recurring billing subscription (1:1) so renewal
 * events can resolve the member for credit allocation.
 */
const wellnessMemberSubscriptionLink =
  hasLinkable(WellnessModule, "wellnessMember") &&
  hasLinkable(SubscriptionModule, "subscription")
    ? defineLink(
        WellnessModule.linkable.wellnessMember,
        SubscriptionModule.linkable.subscription
      )
    : null

export default wellnessMemberSubscriptionLink
