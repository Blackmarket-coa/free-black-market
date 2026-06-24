import { defineLink } from "@medusajs/framework/utils"
import EmbedKeysModule from "../modules/embed-keys"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ Vendor Embed Key (1:many)
 *
 * Links the MercurJS seller to its publishable connect.js keys so a seller's
 * keys can be queried alongside the seller. The seller module is resolved via
 * loadSellerModule() (MercurJS 1.5.0 no longer exports SellerModule from
 * @mercurjs/framework). hasLinkable() guards prevent registering a link with
 * an undefined target.
 */

const { SellerModule } = loadSellerModule("seller-embed-key")

let sellerEmbedKeyLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(EmbedKeysModule, "vendorEmbedKey")
) {
  sellerEmbedKeyLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: EmbedKeysModule.linkable.vendorEmbedKey, isList: true }
  )
}

export default sellerEmbedKeyLink
