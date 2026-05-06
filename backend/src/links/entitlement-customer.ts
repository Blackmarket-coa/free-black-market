import EntitlementModule from "../modules/entitlement"
import CustomerModule from "@medusajs/medusa/customer"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  CustomerModule.linkable.customer,
  {
    linkable: EntitlementModule.linkable.entitlement,
    isList: true,
  }
)
