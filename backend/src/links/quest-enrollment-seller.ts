import { defineLink } from "@medusajs/framework/utils"
import VendorQuestModule from "../modules/vendor-quest"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ Quest Enrollment (1:many)
 *
 * Lets a vendor's quest enrollments be queried alongside the seller. Seller
 * module resolved via loadSellerModule() (MercurJS 1.5.0 compat).
 */
const { SellerModule } = loadSellerModule("quest-enrollment-seller")

let questEnrollmentSellerLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(VendorQuestModule, "questEnrollment")
) {
  questEnrollmentSellerLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: VendorQuestModule.linkable.questEnrollment, isList: true }
  )
}

export default questEnrollmentSellerLink
