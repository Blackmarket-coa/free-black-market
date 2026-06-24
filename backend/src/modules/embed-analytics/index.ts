import { Module } from "@medusajs/framework/utils"
import EmbedAnalyticsService from "./service"

export const EMBED_ANALYTICS_MODULE = "embedAnalytics"

export default Module(EMBED_ANALYTICS_MODULE, {
  service: EmbedAnalyticsService,
})

export * from "./models"
