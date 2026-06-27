import { Module } from "@medusajs/framework/utils"
import WellnessModuleService from "./service"

export const WELLNESS_MODULE = "wellnessModuleService"

export default Module(WELLNESS_MODULE, {
  service: WellnessModuleService,
})

export * from "./models"
