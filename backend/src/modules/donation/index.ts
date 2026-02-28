import { Module } from "@medusajs/framework/utils"
import DonationModuleService from "./service"

export const DONATION_MODULE = "donation"

export default Module(DONATION_MODULE, {
  service: DonationModuleService,
})
