import { Module } from "@medusajs/framework/utils"
import ListingTypeService from "./service"
import seedListingTypeRegistry from "./loaders/seed-registry"

export const LISTING_TYPE_MODULE = "listing_type"

export default Module(LISTING_TYPE_MODULE, {
  service: ListingTypeService,
  // Seeds the catalog registry on every boot; inserts missing rows only.
  loaders: [seedListingTypeRegistry],
})

export * from "./models"
export * from "./catalog"
