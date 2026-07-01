import { defineLink } from "@medusajs/framework/utils"
import DocumentVaultModule from "../modules/document-vault"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ Vault Document (1:many)
 *
 * Lets a vendor's uploaded evidence documents be queried alongside the seller.
 * Seller module resolved via loadSellerModule() (MercurJS 1.5.0 compat); the
 * hasLinkable() guards avoid registering a link with an undefined target.
 */
const { SellerModule } = loadSellerModule("document-vault-seller")

let documentVaultSellerLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(DocumentVaultModule, "vaultDocument")
) {
  documentVaultSellerLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: DocumentVaultModule.linkable.vaultDocument, isList: true }
  )
}

export default documentVaultSellerLink
