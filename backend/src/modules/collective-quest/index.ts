import { Module } from "@medusajs/framework/utils"
import CollectiveQuestModuleService from "./service"

export const COLLECTIVE_QUEST_MODULE = "collectiveQuestModuleService"

export default Module(COLLECTIVE_QUEST_MODULE, {
  service: CollectiveQuestModuleService,
})

export * from "./models"
