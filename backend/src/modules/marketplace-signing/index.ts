import { Module } from "@medusajs/framework/utils"
import PluginSigningService from "./service"

export const MARKETPLACE_SIGNING_MODULE = "marketplaceSigning"

export default Module(MARKETPLACE_SIGNING_MODULE, {
  service: PluginSigningService,
})

export { default as PluginSigningService } from "./service"
export type { PluginSignedBundle, PluginManifestLike } from "./service"
