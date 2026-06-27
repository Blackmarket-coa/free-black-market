import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"
import WellnessModule from "../modules/wellness"
import { hasLinkable } from "./utils/load-seller-module"

/**
 * Link a paid class registration to the order that bought the ticket, so the
 * roster can resolve order/refund state. Guarded against undefined linkables.
 */
const wellnessClassAttendeeOrderLink =
  hasLinkable(WellnessModule, "wellnessClassAttendee") && hasLinkable(OrderModule, "order")
    ? defineLink(
        {
          linkable: WellnessModule.linkable.wellnessClassAttendee,
          isList: true,
        },
        OrderModule.linkable.order
      )
    : null

export default wellnessClassAttendeeOrderLink
