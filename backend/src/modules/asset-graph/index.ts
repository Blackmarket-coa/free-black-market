import { Module } from "@medusajs/framework/utils"
import AssetGraphService from "./service"

export const ASSET_GRAPH_MODULE = "asset_graph"

export default Module(ASSET_GRAPH_MODULE, {
  service: AssetGraphService,
})

export * from "./models"
export * from "./manifests"
export * from "./seed/asset-kinds"
