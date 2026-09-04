import { Module } from "@medusajs/framework/utils"
import AidNetworkModuleService from "./service"

export const AID_NETWORK_MODULE = "aidNetworkModuleService"

export default Module(AID_NETWORK_MODULE, {
  service: AidNetworkModuleService,
})

export * from "./models"
export * from "./allocation"
