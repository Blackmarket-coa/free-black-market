import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import SellerFeedNotificationProviderService from "./service"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [SellerFeedNotificationProviderService],
})
