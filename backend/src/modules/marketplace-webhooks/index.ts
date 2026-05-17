import { Module } from "@medusajs/framework/utils"
import MarketplaceWebhooksService from "./service"

export const MARKETPLACE_WEBHOOKS_MODULE = "marketplaceWebhooks"

export default Module(MARKETPLACE_WEBHOOKS_MODULE, {
  service: MarketplaceWebhooksService,
})

export * from "./models"
export { signWithSecret } from "./service"
