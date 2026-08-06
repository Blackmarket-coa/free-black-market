import { Module } from "@medusajs/framework/utils"
import MutualAidModuleService from "./service"

export const MUTUAL_AID_MODULE = "mutualAidModuleService"

export default Module(MUTUAL_AID_MODULE, {
  service: MutualAidModuleService,
})

export * from "./models"
