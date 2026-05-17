import CooperativeModule from "../modules/cooperative"
import OrderModule from "@medusajs/medusa/order"
import { defineLink } from "@medusajs/framework/utils"

/**
 * Group commerce: associate an Order with the Cooperative it was placed
 * under (if any). One cooperative can back many orders.
 */
export default defineLink(
  OrderModule.linkable.order,
  {
    linkable: CooperativeModule.linkable.cooperative,
    isList: false,
  }
)
