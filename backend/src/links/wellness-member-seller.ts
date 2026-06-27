import { defineLink } from "@medusajs/framework/utils"
import WellnessModule from "../modules/wellness"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link wellness members to sellers (a seller has many members). Convenience for
 * cross-entity graph queries; queries can also just filter by seller_id.
 */
const { SellerModule } = loadSellerModule("wellness-member-seller")

const wellnessMemberSellerLink =
  hasLinkable(SellerModule, "seller") && hasLinkable(WellnessModule, "wellnessMember")
    ? defineLink(
        {
          linkable: WellnessModule.linkable.wellnessMember,
          isList: true,
        },
        SellerModule.linkable.seller
      )
    : null

export default wellnessMemberSellerLink
