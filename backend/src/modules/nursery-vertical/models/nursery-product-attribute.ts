import { model } from "@medusajs/framework/utils"

/**
 * Nursery listing subtype. Extends (never replaces) the platform listing-type;
 * these are physical-goods shapes specific to a plant nursery and live ONLY in
 * this opt-in vertical module — core carries no nursery assumptions.
 */
export enum NurseryListingSubtype {
  LIVE_PLANT_LINER = "live_plant_liner",
  LIVE_PLANT_3_4IN = "live_plant_3_4in",
  LIVE_PLANT_1GAL = "live_plant_1gal",
  LIVE_PLANT_3GAL = "live_plant_3gal",
  BARE_ROOT_DORMANT = "bare_root_dormant",
  CUTTINGS_PADS_BULK = "cuttings_pads_bulk",
  DIVISIONS_PUPS_SLIPS_BULK = "divisions_pups_slips_bulk",
  SEED_PACKET = "seed_packet",
  DRIED_VALUE_ADDED_BY_WEIGHT = "dried_value_added_by_weight",
}

/**
 * Nursery Product Attribute — a per-product extension for the nursery vertical.
 *
 * Linked 1:1 to a Medusa product (via a module link). Holds edible/medicinal
 * use, hardiness zone, propagation method, and channel fit — which also drive
 * printable plant-tag data. Fully usable on its own (listing management +
 * profit-per-sqft) with no quest enrolled.
 */
const NurseryProductAttribute = model.define("nursery_product_attribute", {
  id: model.id().primaryKey(),

  // Owning vendor. Denormalized (the product already belongs to a seller) so
  // attributes are trivially and safely scoped to the vendor in list queries.
  seller_id: model.text(),

  product_id: model.text().unique(),

  subtype: model.enum(Object.values(NurseryListingSubtype)),

  // Use classification (arrays of tags, e.g. ["tea","tincture"]).
  edible_use: model.json().nullable(),
  medicinal_use: model.json().nullable(),

  // USDA hardiness zone range, e.g. "7a-9b".
  hardiness_zone: model.text().nullable(),

  // Propagation method ("seed","cutting","division",...).
  propagation_method: model.text().nullable(),

  // Which sales channels this product is a fit for (NURSERY_CHANNELS values).
  channel_fit: model.json().nullable(), // string[]

  // Cost basis per unit (major units) — feeds profit-per-sqft & valuation cost.
  cost_to_produce: model.float().nullable(),

  // Printable plant-tag payload (denormalized for label printing).
  tag_data: model.json().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["product_id"], name: "IDX_nursery_product_attribute_product_id" },
    { on: ["seller_id"], name: "IDX_nursery_product_attribute_seller_id" },
    { on: ["subtype"], name: "IDX_nursery_product_attribute_subtype" },
  ])

export default NurseryProductAttribute
