import { createLogger } from "../shared/logger"
const log = createLogger("links/listing-type-product")
import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import ListingTypeModule from "../modules/listing-type"

/**
 * Link: Product ↔ ListingType (n:1)
 *
 * Each Medusa Product is linked to one ListingType (physical_product,
 * event, digital, recurring, wholesale, consignment, unique_inventory,
 * bookable, or campaign). Workflow validation on `product.created`
 * asserts the listing-type is allowed for the seller's playbook.
 *
 * See `docs/LISTING_TYPES.md`.
 */

const LOG_PREFIX = "[Link: listing-type-product]"

let listingTypeProductLink: ReturnType<typeof defineLink> | null = null

try {
  if (!ProductModule.linkable?.product) {
    throw new Error("ProductModule.linkable.product is undefined")
  }
  if (!ListingTypeModule.linkable?.listingType) {
    throw new Error("ListingTypeModule.linkable.listingType is undefined")
  }

  listingTypeProductLink = defineLink(
    {
      linkable: ProductModule.linkable.product,
      isList: false,
    },
    {
      linkable: ListingTypeModule.linkable.listingType,
      isList: false,
    }
  )
  log.info(`${LOG_PREFIX} Link defined successfully: product ↔ listing_type`)
} catch (linkError: any) {
  log.error(`${LOG_PREFIX} Failed to define link: ${linkError.message}`)
  listingTypeProductLink = null
}

export default listingTypeProductLink
