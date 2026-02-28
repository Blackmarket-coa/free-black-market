import { Module } from "@medusajs/framework/utils"
import SupplierForwardingModuleService from "./service"

export const SUPPLIER_FORWARDING_MODULE = "supplierForwarding"

export default Module(SUPPLIER_FORWARDING_MODULE, {
  service: SupplierForwardingModuleService,
})
