import { Module } from "@medusajs/framework/utils"
import VendorUsageService from "./service"
import { VENDOR_USAGE_MODULE } from "./module-key"

export { VENDOR_USAGE_MODULE }

export default Module(VENDOR_USAGE_MODULE, {
  service: VendorUsageService,
})
