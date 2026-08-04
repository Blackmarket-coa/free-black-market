import { Module } from "@medusajs/framework/utils"
import ChannelConnectorService from "./service"
import { CHANNEL_CONNECTOR_MODULE } from "./module-key"

export { CHANNEL_CONNECTOR_MODULE }

export default Module(CHANNEL_CONNECTOR_MODULE, {
  service: ChannelConnectorService,
})

export * from "./models"
