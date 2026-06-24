import { Module } from "@medusajs/framework/utils"
import EmbedKeysService from "./service"

export const EMBED_KEYS_MODULE = "embedKeys"

export default Module(EMBED_KEYS_MODULE, {
  service: EmbedKeysService,
})

export * from "./models"
