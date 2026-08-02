import { defineLink } from "@medusajs/framework/utils"
import VendorPlanModule from "../modules/vendor-plan"
import { loadSellerModule, hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Seller ↔ Vendor Plan Assignment (1:1)
 *
 * Lets a seller's current billing plan be queried alongside the seller. Only
 * the assignment is linked — the `vendor_plan` catalog is platform-level and
 * belongs to no single seller.
 *
 * The seller module is resolved via loadSellerModule() (MercurJS 1.5.0 no
 * longer exports SellerModule from @mercurjs/framework); hasLinkable() guards
 * prevent registering a link with an undefined target.
 */

const { SellerModule } = loadSellerModule("seller-vendor-plan-assignment")

let sellerVendorPlanAssignmentLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(SellerModule, "seller") &&
  hasLinkable(VendorPlanModule, "vendorPlanAssignment")
) {
  sellerVendorPlanAssignmentLink = defineLink(
    { linkable: SellerModule.linkable.seller, isList: false },
    { linkable: VendorPlanModule.linkable.vendorPlanAssignment, isList: false }
  )
}

export default sellerVendorPlanAssignmentLink
