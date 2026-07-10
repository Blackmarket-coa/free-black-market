import { Module } from "@medusajs/framework/utils"
import OdooImportModuleService from "./service"

export const ODOO_IMPORT_MODULE = "odooImport"

export default Module(ODOO_IMPORT_MODULE, {
  service: OdooImportModuleService,
})

export * from "./models"
