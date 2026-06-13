import { createLogger } from "../shared/logger"
const log = createLogger("links/subscription-seller")
import { defineLink } from "@medusajs/framework/utils"
import SubscriptionModule from "../modules/subscription"

/**
 * Link subscriptions to sellers
 * A seller can have multiple active subscriptions
 */

let SellerModule: any
try {
  SellerModule = require("@mercurjs/framework").SellerModule
} catch {
  try {
    SellerModule = require("@mercurjs/b2c-core/modules/seller").default
  } catch {
    log.warn("No seller module found - subscription-seller links will not be created")
    SellerModule = null
  }
}

const subscriptionSellerLink = SellerModule
  ? defineLink(
      {
        linkable: SubscriptionModule.linkable.subscription.id,
        isList: true
      },
      SellerModule.linkable.seller
    )
  : null

export default subscriptionSellerLink
