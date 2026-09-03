import { Module } from "@medusajs/framework/utils"
import AccountsReceivableService from "./service"

export const ACCOUNTS_RECEIVABLE_MODULE = "accountsReceivable"

export default Module(ACCOUNTS_RECEIVABLE_MODULE, {
  service: AccountsReceivableService,
})
