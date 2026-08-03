import { Module } from "@medusajs/framework/utils"
import ReferralService from "./service"

export const REFERRAL_MODULE = "referral"

export default Module(REFERRAL_MODULE, {
  service: ReferralService,
})

export * from "./attribution"
