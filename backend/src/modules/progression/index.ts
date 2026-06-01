import { Module } from "@medusajs/framework/utils"
import ProgressionModuleService from "./service"

export const PROGRESSION_MODULE = "progressionModuleService"

export default Module(PROGRESSION_MODULE, {
  service: ProgressionModuleService,
})

export * from "./models"
export * from "./stance"
export * from "./leveling"
