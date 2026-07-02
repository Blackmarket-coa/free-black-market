import { Module } from "@medusajs/framework/utils"
import DocumentVaultModuleService from "./service"

export const DOCUMENT_VAULT_MODULE = "documentVaultModuleService"

export default Module(DOCUMENT_VAULT_MODULE, {
  service: DocumentVaultModuleService,
})

export * from "./models"
