import { Module } from "@medusajs/framework/utils"
import ListingTypeService from "./service"

export const LISTING_TYPE_MODULE = "listing_type"

export default Module(LISTING_TYPE_MODULE, {
  service: ListingTypeService,
})

export * from "./models"
export * from "./catalog"
