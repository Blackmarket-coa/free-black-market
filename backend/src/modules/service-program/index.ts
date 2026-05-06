import { Module } from "@medusajs/framework/utils"
import ServiceProgramService from "./service"

export const SERVICE_PROGRAM_MODULE = "serviceProgram"

export default Module(SERVICE_PROGRAM_MODULE, {
  service: ServiceProgramService,
})

export * from "./models"
export type { ServiceProgramService }
