import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createLogger } from "./logger"
import { LISTING_TYPE_MODULE } from "../modules/listing-type"
import type { ListingTypeId } from "../modules/listing-type"
import type ListingTypeService from "../modules/listing-type/service"

const log = createLogger("shared/listing-type-link")

/**
 * Link a product a vendor just created to its listing type's registry row
 * (`links/listing-type-product.ts`), which the storefront's product page,
 * the vendor page's service and digital grids, the playbook-switch preflight
 * and the one-of-a-kind and consignment paths read. Nothing wrote the link,
 * so the listing type a product was created with was checked and then lost.
 *
 * Best effort, after the product exists: a missing registry row or a failed
 * write leaves the product untyped (read as a physical product) and is
 * logged, rather than answering an error for a product that was made.
 */
export async function linkProductListingType(
  scope: MedusaContainer,
  productId: string,
  listingTypeId: ListingTypeId
): Promise<void> {
  try {
    const listingTypes = scope.resolve<ListingTypeService>(LISTING_TYPE_MODULE)
    const [row] = await listingTypes.listListingTypes({ catalog_id: listingTypeId })
    if (!row) {
      log.warn(
        `Product ${productId} left without a listing type: the listing-type registry has no "${listingTypeId}" row`
      )
      return
    }
    await scope.resolve(ContainerRegistrationKeys.LINK).create({
      [Modules.PRODUCT]: { product_id: productId },
      [LISTING_TYPE_MODULE]: { listing_type_id: row.id },
    })
  } catch (error) {
    log.warn(
      `Could not link product ${productId} to listing type "${listingTypeId}": ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
