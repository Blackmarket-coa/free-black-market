import { Module } from "@medusajs/framework/utils"
import VendorQuestModuleService from "./service"

export const VENDOR_QUEST_MODULE = "vendorQuestModuleService"

export default Module(VENDOR_QUEST_MODULE, {
  service: VendorQuestModuleService,
})

export * from "./models"
export * from "./types"
export { evaluateQuest } from "./engine"
export { buildSubstrate } from "./substrate/build"
export { computeRevenueSummary } from "./substrate/revenue"
export { getQuestDefinition, listQuestDefinitions } from "./definitions"
