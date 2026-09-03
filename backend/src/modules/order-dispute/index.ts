import { Module } from "@medusajs/framework/utils"
import OrderDisputeService from "./service"

export const ORDER_DISPUTE_MODULE = "orderDispute"

export default Module(ORDER_DISPUTE_MODULE, {
  service: OrderDisputeService,
})
