/**
 * Plant Network — typed view over product metadata.
 *
 * STORAGE NOTE: MedusaJS v2 products already carry a freeform JSON `metadata`
 * column. We do NOT add new DB columns for plant fields — these interfaces are
 * the *typed read/write view* over `product.metadata`. Producers/lots are
 * modeled separately (see `modules/agriculture` Harvest→Lot→AvailabilityWindow
 * and `links/product-availability.ts`); this file only describes the plant-
 * specific keys that storefront + checkout logic should read off a product.
 *
 * The canonical settlement rail vocabulary lives in
 * `modules/hawala-ledger/rails.ts` (RailCode). Grower node IDs below are an
 * application-level concept layered on top of stock locations + producers.
 */

export type PropMethod =
  | "seed"
  | "cutting"
  | "plug"
  | "bareroot"
  | "division"
  | "airlayer"
  | "layering"
  | "graft"
  | "offset"

/**
 * Grower node identifiers. These map 1:1 to MedusaJS stock locations (see
 * `loaders/init-stock-location.ts` for how locations are provisioned) and to
 * producer records (`modules/producer`). `hub_sc` is the hub/coordinator node.
 */
export type GrowerNode =
  | "hub_sc"
  | "node_ga"
  | "node_fl"
  | "node_nc_mtn"
  | "node_nc_pied"
  | "node_va"
  | "node_md"
  | "node_ny"

/**
 * The plant-specific keys read off `product.metadata`. All optional at the type
 * boundary because legacy/non-plant products won't carry them; consumers should
 * treat absence as "not a managed live-plant listing".
 */
export interface PlantProductMetadata {
  grower_node?: GrowerNode
  zone_hardy_min?: number // USDA zone, e.g. 7
  zone_hardy_max?: number // USDA zone, e.g. 11
  prop_method?: PropMethod
  ship_window_open?: string | null // ISO date; null = always available
  ship_window_close?: string | null // ISO date; null = always available
  is_live_plant?: boolean // triggers live-plant shipping rules
  requires_phyto_cert?: boolean // triggers compliance gate at checkout
  days_to_ship?: number // propagation lead time before ship
  forage_sourced?: boolean // true = wild-harvested, not propagated
  bulk_min_qty?: number // minimum order qty for wholesale/plug listings
  tray_cell_count?: number // plug trays: 36 | 50 | 72 ...
}

/**
 * Convenience: the metadata key names as a const, so writers don't drift from
 * the type above. Use when persisting via the product module's update API.
 */
export const PLANT_METADATA_KEYS = [
  "grower_node",
  "zone_hardy_min",
  "zone_hardy_max",
  "prop_method",
  "ship_window_open",
  "ship_window_close",
  "is_live_plant",
  "requires_phyto_cert",
  "days_to_ship",
  "forage_sourced",
  "bulk_min_qty",
  "tray_cell_count",
] as const satisfies ReadonlyArray<keyof PlantProductMetadata>

/** Narrowing helper: read the plant view off an arbitrary product metadata bag. */
export function readPlantMetadata(
  metadata: Record<string, unknown> | null | undefined
): PlantProductMetadata {
  return (metadata ?? {}) as PlantProductMetadata
}
