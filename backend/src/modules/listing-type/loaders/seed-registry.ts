import type { LoaderOptions } from "@medusajs/framework/types"
import { createLogger } from "../../../shared/logger"
import {
  seedMissingRegistryRows,
  type RegistryModelService,
} from "../../../shared/registry-seed"
import {
  listingTypeRegistryRows,
  type ListingTypeRegistryRow,
} from "../registry"

/**
 * The key Medusa registers the `ListingType` model's internal service under
 * in this module's own container (`model.define("listing_type")` names the
 * entity `ListingType`); see the playbook module's loader for why a module
 * loader reads it there.
 */
export const LISTING_TYPE_MODEL_SERVICE_KEY = "listingTypeService"

/**
 * Seed the `listing_type` registry from the catalog in code on every boot,
 * inserting only the entries it lacks (`shared/registry-seed.ts`). A vendor
 * product is linked to its listing type's row (`links/listing-type-product.ts`),
 * so the row has to exist for the link to be written.
 */
export default async function seedListingTypeRegistry({
  container,
  logger,
}: LoaderOptions): Promise<void> {
  const log = logger ?? createLogger("modules/listing-type/seed-registry")
  let service: RegistryModelService<ListingTypeRegistryRow>
  try {
    service = container.resolve(LISTING_TYPE_MODEL_SERVICE_KEY)
  } catch (error) {
    log.warn(
      `[listing-type registry] no "${LISTING_TYPE_MODEL_SERVICE_KEY}" in the module container, so nothing was seeded: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return
  }
  await seedMissingRegistryRows({
    label: "[listing-type registry]",
    service,
    key: "catalog_id",
    rows: listingTypeRegistryRows(),
    logger: log,
  })
}
