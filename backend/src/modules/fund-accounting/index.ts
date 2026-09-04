import { Module } from "@medusajs/framework/utils"
import FundAccountingModuleService from "./service"

export const FUND_ACCOUNTING_MODULE = "fundAccountingModuleService"

export default Module(FUND_ACCOUNTING_MODULE, {
  service: FundAccountingModuleService,
})

export * from "./models"
export * from "./fund-math"
