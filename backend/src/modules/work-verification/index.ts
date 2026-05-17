import { Module } from "@medusajs/framework/utils"
import WorkVerificationService from "./service"

export const WORK_VERIFICATION_MODULE = "workVerification"

export default Module(WORK_VERIFICATION_MODULE, {
  service: WorkVerificationService,
})

export * from "./models"
export type { WorkVerificationService }
