import { Module } from "@medusajs/framework/utils"
import ProductionLedgerModuleService from "./service"

export const PRODUCTION_LEDGER_MODULE = "productionLedgerModuleService"

export default Module(PRODUCTION_LEDGER_MODULE, {
  service: ProductionLedgerModuleService,
})

export * from "./models"
