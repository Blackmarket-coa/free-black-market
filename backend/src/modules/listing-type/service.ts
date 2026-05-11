import { MedusaService } from "@medusajs/framework/utils"
import { ListingType } from "./models"
import {
  LISTING_TYPE_CATALOG,
  LISTING_TYPE_IDS,
  getListingType,
} from "./catalog"
import type { ListingTypeId, ListingTypeDefinition } from "./catalog"

class ListingTypeService extends MedusaService({
  ListingType,
}) {
  /**
   * In-code catalog lookup. Throws on unknown id. Prefer this over a DB
   * read when you only need the shape (capacity, recurrence, escrow).
   */
  getDefinition(id: ListingTypeId): ListingTypeDefinition {
    return getListingType(id)
  }

  listCatalogIds(): ListingTypeId[] {
    return LISTING_TYPE_IDS.slice()
  }

  listCatalog(): ListingTypeDefinition[] {
    return LISTING_TYPE_IDS.map((id) => LISTING_TYPE_CATALOG[id])
  }
}

export default ListingTypeService
