import { model } from "@medusajs/framework/utils"

/**
 * Where the input material for a batch came from. Kept generic so the ledger
 * describes any production process, not just plant propagation.
 */
export enum ProductionSource {
  OWN = "own",
  FORAGED = "foraged",
  SWAP = "swap",
  PURCHASED = "purchased",
}

export enum ProductionBatchStatus {
  STARTED = "started",
  GROWING = "growing",
  READY = "ready",
  SOLD_OUT = "sold_out",
  LOST = "lost",
}

/**
 * Production Batch — a generic "what was made/grown" record.
 *
 * OPT-IN domain module. Present only for vendors who actually produce things
 * (a nursery's propagation batch, a maker's production run, a bakery's bake).
 * Service / digital / practitioner vendors never touch it, and the quest engine
 * treats production data as a *domain-optional* substrate field that is simply
 * absent for them.
 *
 * A batch can link to the sellable variant it produced (`product_variant_id`)
 * and to a harvest_batch, so "produced vs. sold" reconstructs from real orders
 * without a parallel inventory ledger. Vertical-specific attributes (pot size,
 * controlled-environment details, crop cultivar, ...) live in `attributes`
 * JSON — never as hardcoded columns.
 */
const ProductionBatch = model.define("production_batch", {
  id: model.id().primaryKey(),

  seller_id: model.text(),

  // Human label for what was produced ("Elderberry liners", "Sourdough").
  item_label: model.text(),

  // Free-form production method ("softwood cutting", "seed", "division").
  method: model.text().nullable(),

  // When production started, and quantity started.
  start_date: model.dateTime().nullable(),
  qty_started: model.number().default(0),

  source: model.enum(Object.values(ProductionSource)).default(ProductionSource.OWN),

  // Whether a controlled environment (greenhouse, proofing box, ...) was used.
  controlled_environment: model.boolean().default(false),

  // Realized yield (units that became sellable). Nullable until known.
  yield_qty: model.number().nullable(),

  status: model
    .enum(Object.values(ProductionBatchStatus))
    .default(ProductionBatchStatus.STARTED),

  // Optional links into the sellable side for produced-vs-sold reconstruction.
  product_variant_id: model.text().nullable(),
  harvest_batch_id: model.text().nullable(),

  // Vertical-specific fields live here, never as columns (keeps core generic).
  attributes: model.json().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_production_batch_seller_id" },
    { on: ["product_variant_id"], name: "IDX_production_batch_variant_id" },
    { on: ["status"], name: "IDX_production_batch_status" },
  ])

export default ProductionBatch
