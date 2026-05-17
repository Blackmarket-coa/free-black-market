import EntitlementModule from "../modules/entitlement"
import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  ProductModule.linkable.product,
  {
    linkable: EntitlementModule.linkable.entitlement,
    isList: true,
  }
)
