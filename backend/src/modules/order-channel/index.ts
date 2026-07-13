import { Module } from "@medusajs/framework/utils"
import OrderChannelService from "./service"

export const ORDER_CHANNEL_MODULE = "order_channel"

export default Module(ORDER_CHANNEL_MODULE, {
  service: OrderChannelService,
})

export * from "./models"
