import { Module } from "@medusajs/framework/utils"
import PlaybookService from "./service"

export const PLAYBOOK_MODULE = "playbook"

export default Module(PLAYBOOK_MODULE, {
  service: PlaybookService,
})

export * from "./models"
export * from "./recipes"
export * from "./recommend"
export * from "./recommend-from-resources"
export * from "./features"
