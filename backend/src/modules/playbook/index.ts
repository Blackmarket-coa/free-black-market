import { Module } from "@medusajs/framework/utils"
import PlaybookService from "./service"
import seedPlaybookRegistry from "./loaders/seed-registry"

export const PLAYBOOK_MODULE = "playbook"

export default Module(PLAYBOOK_MODULE, {
  service: PlaybookService,
  // Seeds the recipe registry on every boot; inserts missing rows only.
  loaders: [seedPlaybookRegistry],
})

export * from "./models"
export * from "./recipes"
export * from "./recommend"
export * from "./recommend-from-resources"
export * from "./features"
export * from "./progressions"
