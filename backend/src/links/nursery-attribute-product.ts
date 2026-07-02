import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import NurseryVerticalModule from "../modules/nursery-vertical"
import { hasLinkable } from "./utils/load-seller-module"

/**
 * Link: Product ↔ Nursery Product Attribute (1:1)
 *
 * Lets nursery-specific attributes be queried alongside the core product,
 * keeping all nursery assumptions out of the product schema itself.
 */
let nurseryAttributeProductLink: ReturnType<typeof defineLink> | null = null

if (
  hasLinkable(ProductModule, "product") &&
  hasLinkable(NurseryVerticalModule, "nurseryProductAttribute")
) {
  nurseryAttributeProductLink = defineLink(
    { linkable: ProductModule.linkable.product, isList: false },
    { linkable: NurseryVerticalModule.linkable.nurseryProductAttribute, isList: false }
  )
}

export default nurseryAttributeProductLink
