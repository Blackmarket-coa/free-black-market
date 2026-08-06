import { Module } from "@medusajs/framework/utils"
import BarterModuleService from "./service"

export const BARTER_MODULE = "barterModuleService"

export default Module(BARTER_MODULE, {
  service: BarterModuleService,
})

export * from "./models"
