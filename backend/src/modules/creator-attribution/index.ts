import { Module } from "@medusajs/framework/utils"
import CreatorAttributionService from "./service"

export const CREATOR_ATTRIBUTION_MODULE = "creatorAttribution"

export default Module(CREATOR_ATTRIBUTION_MODULE, {
  service: CreatorAttributionService,
})

export * from "./models"
export type { CreatorAttributionService }
