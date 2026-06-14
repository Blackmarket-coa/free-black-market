import { Module } from "@medusajs/framework/utils"
import PluginRegistryService from "./service"

export const PLUGIN_REGISTRY_MODULE = "plugin_registry"

export default Module(PLUGIN_REGISTRY_MODULE, {
  service: PluginRegistryService,
})

export * from "./models"
export { PLUGIN_SEED, type PluginSeed } from "./catalog"
