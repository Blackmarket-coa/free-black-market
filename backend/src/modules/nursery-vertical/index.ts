import { Module } from "@medusajs/framework/utils"
import NurseryVerticalModuleService from "./service"

export const NURSERY_VERTICAL_MODULE = "nurseryVerticalModuleService"

export default Module(NURSERY_VERTICAL_MODULE, {
  service: NurseryVerticalModuleService,
})

export * from "./models"
export * from "./channels"
export { profitPerSqFt, rankByAnnualProfitPerSqFt } from "./analytics/profit-per-sqft"
