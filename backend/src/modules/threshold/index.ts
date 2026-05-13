import { Module } from "@medusajs/framework/utils"
import ThresholdModuleService from "./service"

export const THRESHOLD_MODULE = "threshold"

export default Module(THRESHOLD_MODULE, {
  service: ThresholdModuleService,
})

export * from "./models"
export * from "./policy"
