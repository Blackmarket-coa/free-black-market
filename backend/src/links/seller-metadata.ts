import { defineLink } from "@medusajs/framework/utils"
import SellerExtensionModule from "../modules/seller-extension"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ Seller Metadata (1:1)
 *
 * Links the MercurJS seller to our extension metadata (vendor_type,
 * certifications, ...) so those fields can be queried alongside the seller.
 *
 * The seller module is resolved via loadSellerModule() (MercurJS 1.5.0 no
 * longer exports SellerModule from @mercurjs/framework). hasLinkable() guards
 * prevent registering a link with an undefined target.
 */

const { SellerModule } = loadSellerModule("seller-metadata")

let sellerMetadataLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(SellerExtensionModule, "sellerMetadata")
) {
  sellerMetadataLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: SellerExtensionModule.linkable.sellerMetadata, isList: false }
  )
}

export default sellerMetadataLink
