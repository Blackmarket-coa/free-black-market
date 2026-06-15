import { defineLink } from "@medusajs/framework/utils"
import PlaybookModule from "../modules/playbook"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ PlaybookAssignment (1:1)
 *
 * Links the MercurJS seller to their playbook assignment (the cooperative-
 * economic shape picked at setup). At most one current assignment per seller.
 *
 * The seller module is resolved via loadSellerModule() (MercurJS 1.5.0 no
 * longer exports SellerModule from @mercurjs/framework). hasLinkable() guards
 * prevent registering a link with an undefined target.
 */

const { SellerModule } = loadSellerModule("playbook-seller")

let playbookSellerLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(PlaybookModule, "playbookAssignment")
) {
  playbookSellerLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: PlaybookModule.linkable.playbookAssignment, isList: false }
  )
}

export default playbookSellerLink
