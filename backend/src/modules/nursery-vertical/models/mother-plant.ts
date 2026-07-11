import { model } from "@medusajs/framework/utils"

/**
 * Mother Plant — a propagation source plant a nursery keeps on hand (for
 * cuttings, divisions, seed collection). Tracked so the vendor can plan
 * harvest windows and estimated cutting yields.
 */
const MotherPlant = model.define("mother_plant", {
  id: model.id().primaryKey(),

  // Owning vendor — every list query is seller-scoped.
  seller_id: model.text(),

  species_name: model.text(),
  location: model.text(),

  last_harvest_at: model.dateTime().nullable(),
  // Human-readable window, e.g. "late June – July".
  next_harvest_window: model.text().nullable(),
  // Estimated cuttings/divisions per harvest.
  estimated_yield: model.number().nullable(),

  metadata: model.json().nullable(),
}).indexes([{ on: ["seller_id"], name: "IDX_mother_plant_seller_id" }])

export default MotherPlant
