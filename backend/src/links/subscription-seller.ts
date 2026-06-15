import { defineLink } from "@medusajs/framework/utils"
import SubscriptionModule from "../modules/subscription"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link subscriptions to sellers. A seller can have multiple active subscriptions.
 *
 * The seller module is resolved via loadSellerModule() (MercurJS 1.5.0 no
 * longer exports SellerModule from @mercurjs/framework). hasLinkable() guards
 * prevent registering a link with an undefined target — this previously passed
 * `SellerModule.linkable.seller` without verifying it existed.
 */

const { SellerModule } = loadSellerModule("subscription-seller")

const subscriptionSellerLink =
  hasLinkable(SellerModule, "seller") && hasLinkable(SubscriptionModule, "subscription")
    ? defineLink(
        {
          linkable: SubscriptionModule.linkable.subscription.id,
          isList: true,
        },
        SellerModule.linkable.seller
      )
    : null

export default subscriptionSellerLink
