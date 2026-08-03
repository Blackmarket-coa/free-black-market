import { Module } from "@medusajs/framework/utils"
import VendorBillingService from "./service"

export const VENDOR_BILLING_MODULE = "vendorBilling"

export default Module(VENDOR_BILLING_MODULE, {
  service: VendorBillingService,
})

export * from "./charges"
