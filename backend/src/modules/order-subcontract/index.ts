import { Module } from "@medusajs/framework/utils"
import OrderSubcontractService from "./service"

export const ORDER_SUBCONTRACT_MODULE = "orderSubcontract"

export default Module(ORDER_SUBCONTRACT_MODULE, {
  service: OrderSubcontractService,
})

export * from "./models"
export type { OrderSubcontractService }
