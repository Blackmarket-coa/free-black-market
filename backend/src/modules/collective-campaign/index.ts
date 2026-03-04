import { Module } from "@medusajs/framework/utils"
import CollectiveCampaignModuleService from "./service"

export const COLLECTIVE_CAMPAIGN_MODULE = "collectiveCampaignModuleService"

export default Module(COLLECTIVE_CAMPAIGN_MODULE, {
  service: CollectiveCampaignModuleService,
})

export * from "./models"
