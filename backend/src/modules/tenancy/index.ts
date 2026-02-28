import { Module } from "@medusajs/framework/utils"
import TenancyModuleService from "./service"

export const TENANCY_MODULE = "tenancy"

export default Module(TENANCY_MODULE, {
  service: TenancyModuleService,
})
