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
 * bookable, or campaign), and a listing type to many products. The vendor
 * create routes check the type against the seller's playbook
 * (`shared/listing-type-guard.ts`) and write the link
 * (`shared/listing-type-link.ts`).
 *
 * `isList: true` on the product side is what makes it n:1. Both sides were
 * `isList: false`, a one-to-one link, so Medusa's link service refused a
 * second product of any type ("Cannot create multiple links between
 * 'product' and 'listing_type'", measured on Postgres); nothing wrote the
 * link before, so it never showed. Cardinality is checked by the link
 * service only: the pivot table is the same either way.
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
      isList: true,
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
