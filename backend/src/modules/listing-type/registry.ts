import { LISTING_TYPE_CATALOG, LISTING_TYPE_IDS } from "./catalog"
import type { ListingTypeDefinition } from "./catalog"

/**
 * The `listing_type` row a catalog entry seeds: the one shape both the boot
 * loader (`loaders/seed-registry.ts`, which inserts missing rows) and
 * `scripts/seed-playbooks.ts` (which also overwrites drift) write.
 */
export function listingTypeRegistryRow(def: ListingTypeDefinition) {
  return {
    catalog_id: def.id,
    display_name: def.display_name,
    description: def.description,
    requires_shipping: def.requires_shipping,
    requires_capacity: def.requires_capacity,
    requires_recurrence: def.requires_recurrence,
    requires_escrow: def.requires_escrow,
    unique_inventory: def.unique_inventory,
    is_active: true,
  }
}

export type ListingTypeRegistryRow = ReturnType<typeof listingTypeRegistryRow>

/** Every catalog entry's row, in catalog order. */
export const listingTypeRegistryRows = (): ListingTypeRegistryRow[] =>
  LISTING_TYPE_IDS.map((id) => listingTypeRegistryRow(LISTING_TYPE_CATALOG[id]))
