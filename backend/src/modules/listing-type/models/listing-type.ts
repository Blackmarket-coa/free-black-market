import { model } from "@medusajs/framework/utils"

/**
 * ListingType
 *
 * Registry of the v1 listing-types. Source of truth lives in
 * `backend/src/modules/listing-type/catalog/index.ts`; this table is the
 * denormalized, query-friendly view seeded from that catalog.
 *
 * Each `Product` is module-linked to exactly one `ListingType` via
 * `backend/src/links/listing-type-product.ts`. Playbook compatibility is
 * enforced as a workflow step on `product.created`, not as a DB
 * constraint (so seed data is never rejected).
 *
 * See `docs/LISTING_TYPES.md`.
 */
const ListingType = model.define("listing_type", {
  id: model.id().primaryKey(),

  /** Catalog identifier (physical_product | event | digital | ...). */
  catalog_id: model.text().unique(),

  display_name: model.text(),
  description: model.text(),

  requires_shipping: model.boolean().default(false),
  requires_capacity: model.boolean().default(false),
  requires_recurrence: model.boolean().default(false),
  requires_escrow: model.boolean().default(false),
  unique_inventory: model.boolean().default(false),

  /** Whether the listing-type is currently selectable for new products. */
  is_active: model.boolean().default(true),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["catalog_id"], name: "IDX_listing_type_catalog_id" },
  { on: ["is_active"], name: "IDX_listing_type_is_active" },
])

export default ListingType
