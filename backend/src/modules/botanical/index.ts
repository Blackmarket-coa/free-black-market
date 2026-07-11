import { Module } from "@medusajs/framework/utils"
import BotanicalModuleService from "./service"

export const BOTANICAL_MODULE = "botanicalModuleService"

export default Module(BOTANICAL_MODULE, {
  service: BotanicalModuleService,
})

export * from "./models"
export {
  PATHWAY_TEMPLATES,
  getPathwayTemplate,
  type PathwayTemplate,
} from "./catalog/pathway-templates"
