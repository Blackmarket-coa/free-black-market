import { Module } from "@medusajs/framework/utils"
import ProductionCostingModuleService from "./service"

export const PRODUCTION_COSTING_MODULE = "productionCostingModuleService"

export default Module(PRODUCTION_COSTING_MODULE, {
  service: ProductionCostingModuleService,
})

export * from "./models"
export * from "./costing"
