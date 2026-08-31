import { Module } from "@medusajs/framework/utils"
import NativePushModuleService from "./service"

export const NATIVE_PUSH_MODULE = "nativePush"

export default Module(NATIVE_PUSH_MODULE, {
  service: NativePushModuleService,
})

export * from "./models"
