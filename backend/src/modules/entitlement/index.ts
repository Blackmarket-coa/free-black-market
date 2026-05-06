import { Module } from "@medusajs/framework/utils"
import EntitlementModuleService from "./service"

export const ENTITLEMENT_MODULE = "entitlement"

export default Module(ENTITLEMENT_MODULE, {
  service: EntitlementModuleService,
})

export * from "./models"
