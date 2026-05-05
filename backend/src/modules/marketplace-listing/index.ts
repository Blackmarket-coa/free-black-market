import { Module } from "@medusajs/framework/utils"
import MarketplaceListingService from "./service"

export const MARKETPLACE_LISTING_MODULE = "marketplaceListing"

export default Module(MARKETPLACE_LISTING_MODULE, {
  service: MarketplaceListingService,
})

export * from "./models"
