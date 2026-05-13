import { Module } from "@medusajs/framework/utils"
import SellSignupModuleService from "./service"

export const SELL_SIGNUP_MODULE = "sell_signup"

export default Module(SELL_SIGNUP_MODULE, {
  service: SellSignupModuleService,
})
