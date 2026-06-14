import { createLogger } from "../shared/logger"
const log = createLogger("links/woocommerce-connection-seller")
import { defineLink } from "@medusajs/framework/utils"
import WooCommerceImportModule from "../modules/woocommerce-import"

/**
 * Link: WooCommerce Connection ↔ Seller (1:1)
 *
 * Links a WooCommerce connection to the MercurJS seller entity.
 * This enables querying a seller's WooCommerce connection alongside
 * other seller data.
 *
 * Usage in queries:
 *   query.graph({
 *     entity: "seller",
 *     fields: ["*", "woocommerce_connection.*"],
 *   })
 */

const LOG_PREFIX = "[Link: woocommerce-connection-seller]"

let SellerModule: any = null

try {
  SellerModule = require("@mercurjs/framework").SellerModule
  log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/framework`)
} catch (_frameworkError: any) {
  try {
    SellerModule = require("@mercurjs/b2c-core/modules/seller").default
    log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/b2c-core`)
  } catch (_b2cError: any) {
    log.error(`${LOG_PREFIX} Failed to load SellerModule`)
    log.error(`${LOG_PREFIX} woocommerce_connection link will NOT be created`)
  }
}

let wooConnectionSellerLink: ReturnType<typeof defineLink> | null = null

if (SellerModule) {
  try {
    if (!SellerModule.linkable?.seller) {
      throw new Error("SellerModule.linkable.seller is undefined")
    }
    if (!WooCommerceImportModule.linkable?.woocommerceConnection) {
      throw new Error("WooCommerceImportModule.linkable.woocommerceConnection is undefined")
    }

    wooConnectionSellerLink = defineLink(
      {
        linkable: SellerModule.linkable.seller,
        isList: false,
      },
      {
        linkable: WooCommerceImportModule.linkable.woocommerceConnection,
        isList: false,
      }
    )
    log.info(`${LOG_PREFIX} Link defined successfully`)
  } catch (linkError: any) {
    log.error(`${LOG_PREFIX} Failed to define link: ${linkError.message}`)
    wooConnectionSellerLink = null
  }
}

export default wooConnectionSellerLink
