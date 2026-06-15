import { defineLink } from "@medusajs/framework/utils"
import WooCommerceImportModule from "../modules/woocommerce-import"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: WooCommerce Connection ↔ Seller (1:1)
 *
 * Links a WooCommerce connection to the MercurJS seller entity so a seller's
 * connection can be queried alongside other seller data.
 *
 * The seller module is resolved via loadSellerModule() (MercurJS 1.5.0 no
 * longer exports SellerModule from @mercurjs/framework). hasLinkable() guards
 * prevent registering a link with an undefined target.
 */

const { SellerModule } = loadSellerModule("woocommerce-connection-seller")

let wooConnectionSellerLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(WooCommerceImportModule, "woocommerceConnection")
) {
  wooConnectionSellerLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: WooCommerceImportModule.linkable.woocommerceConnection, isList: false }
  )
}

export default wooConnectionSellerLink
