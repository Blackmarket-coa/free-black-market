import { Module } from "@medusajs/framework/utils"
import RefrainModuleService from "./service"

export const REFRAIN_MODULE = "refrain"

export default Module(REFRAIN_MODULE, {
  service: RefrainModuleService,
})

export * from "./models"
export * from "./policy"
