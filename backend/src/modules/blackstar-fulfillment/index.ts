import { Module } from "@medusajs/framework/utils"
import BlackstarFulfillmentModuleService from "./service"

export const BLACKSTAR_FULFILLMENT_MODULE = "blackstarFulfillment"

export default Module(BLACKSTAR_FULFILLMENT_MODULE, {
  service: BlackstarFulfillmentModuleService,
})

export * from "./models"
