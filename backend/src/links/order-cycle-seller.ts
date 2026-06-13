import { createLogger } from "../shared/logger"
const log = createLogger("links/order-cycle-seller")
import { defineLink } from "@medusajs/framework/utils"
import OrderCycleModule from "../modules/order-cycle"

/**
 * Link Order Cycle to MercurJS Seller
 * 
 * This links the order cycle's coordinator to a MercurJS seller.
 * Note: MercurJS uses @mercurjs/b2c-core which exports a seller module.
 * 
 * If MercurJS seller module is not available, fall back to Medusa's 
 * marketplace recipe vendor pattern.
 */

// Try to import MercurJS seller module, fall back to custom marketplace module
let SellerModule: any
try {
  // MercurJS packages export their modules
  // The seller module key is typically "seller" or from @mercurjs/framework
  SellerModule = require("@mercurjs/framework").SellerModule
} catch {
  // Fallback: If not using MercurJS, use your own marketplace module
  // This follows the Medusa marketplace recipe pattern
  try {
    SellerModule = require("../modules/marketplace").default
  } catch {
    log.warn("No seller module found - order cycle links will not be created")
    SellerModule = null
  }
}

// Only define link if seller module is available
const orderCycleSellerLink = SellerModule
  ? defineLink(
      // Order cycles can have one coordinator seller
      OrderCycleModule.linkable.orderCycle,
      {
        linkable: SellerModule.linkable.seller,
        isList: false,
      }
    )
  : null

export default orderCycleSellerLink
