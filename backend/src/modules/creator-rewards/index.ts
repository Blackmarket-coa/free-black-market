import { Module } from "@medusajs/framework/utils"
import CreatorRewardsService from "./service"

export const CREATOR_REWARDS_MODULE = "creatorRewards"

export default Module(CREATOR_REWARDS_MODULE, {
  service: CreatorRewardsService,
})

export * from "./models"
export type { CreatorRewardsService }
