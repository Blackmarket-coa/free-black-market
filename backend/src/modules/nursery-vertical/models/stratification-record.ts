import { model } from "@medusajs/framework/utils"

/**
 * Stratification Record — a cold/warm pre-treatment cycle a nursery vendor runs
 * on seed lots before sowing (e.g. "cold moist", 90 days). Surfaced alongside
 * propagation batches on the portal's Propagation page so growers can track
 * when a lot is ready to sow.
 */
const StratificationRecord = model.define("stratification_record", {
  id: model.id().primaryKey(),

  // Owning vendor — every list query is seller-scoped.
  seller_id: model.text(),

  species_name: model.text(),

  // Treatment type, e.g. "cold moist", "warm", "cold dry".
  type: model.text(),

  start_at: model.dateTime(),
  duration_days: model.number(),
  end_at: model.dateTime(),

  location: model.text().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_stratification_record_seller_id" },
    { on: ["end_at"], name: "IDX_stratification_record_end_at" },
  ])

export default StratificationRecord
