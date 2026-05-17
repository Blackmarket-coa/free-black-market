import CollectiveCampaignModule from "../modules/collective-campaign"
import OrderModule from "@medusajs/medusa/order"
import { defineLink } from "@medusajs/framework/utils"

/**
 * Group commerce: associate an Order with the CollectiveCampaign it was
 * placed under (if any). One campaign backs many orders.
 */
export default defineLink(
  OrderModule.linkable.order,
  {
    linkable: CollectiveCampaignModule.linkable.collectiveCampaign,
    isList: false,
  }
)
