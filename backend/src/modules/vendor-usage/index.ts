import { Module } from "@medusajs/framework/utils"
import VendorUsageService from "./service"

export const VENDOR_USAGE_MODULE = "vendorUsage"

export default Module(VENDOR_USAGE_MODULE, {
  service: VendorUsageService,
})
