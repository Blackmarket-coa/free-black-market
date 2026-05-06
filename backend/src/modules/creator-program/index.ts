import { Module } from "@medusajs/framework/utils"
import CreatorProgramService from "./service"

export const CREATOR_PROGRAM_MODULE = "creatorProgram"

export default Module(CREATOR_PROGRAM_MODULE, {
  service: CreatorProgramService,
})

export * from "./models"
export type { CreatorProgramService }
