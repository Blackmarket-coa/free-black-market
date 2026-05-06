import { Module } from "@medusajs/framework/utils"
import ContentPlatformService from "./service"

export const CONTENT_PLATFORM_MODULE = "contentPlatform"

export default Module(CONTENT_PLATFORM_MODULE, {
  service: ContentPlatformService,
})

export * from "./models"
export * from "./providers/types"
export type { ContentPlatformService }
