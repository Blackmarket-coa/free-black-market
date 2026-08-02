import { Module } from "@medusajs/framework/utils"
import VendorPlanService from "./service"

export const VENDOR_PLAN_MODULE = "vendorPlan"

export default Module(VENDOR_PLAN_MODULE, {
  service: VendorPlanService,
})

export * from "./models"
export * from "./catalog"
export * from "./transitions"
