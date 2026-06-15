import { defineLink } from "@medusajs/framework/utils"
import OrderCycleModule from "../modules/order-cycle"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Order Cycle ↔ Seller
 *
 * Links an order cycle's coordinator to a MercurJS seller.
 *
 * The seller module is resolved via loadSellerModule() (MercurJS 1.5.0 no
 * longer exports SellerModule from @mercurjs/framework). hasLinkable() guards
 * prevent registering a link with an undefined target.
 */

const { SellerModule } = loadSellerModule("order-cycle-seller")

let orderCycleSellerLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(OrderCycleModule, "orderCycle") &&
  hasLinkable(SellerModule, "seller")
) {
  orderCycleSellerLink = defineLink(
    // Order cycles can have one coordinator seller
    OrderCycleModule.linkable.orderCycle,
    {
      linkable: SellerModule.linkable.seller,
      isList: false,
    }
  )
}

export default orderCycleSellerLink
