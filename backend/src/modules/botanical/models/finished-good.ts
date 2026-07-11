import { model } from "@medusajs/framework/utils"
import { OUTPUT_CATEGORIES } from "./pathway"

export const FINISHED_GOOD_STATUSES = [
  "available",
  "reserved",
  "shipped",
  "quarantine",
  "expired",
] as const
export type FinishedGoodStatus = (typeof FINISHED_GOOD_STATUSES)[number]

/**
 * Finished Good — sellable stock produced by a run: SKU'd, batch-numbered,
 * expiry-tracked, wholesale-flagged. Seed goods additionally carry germination
 * results (rate + test date, required by seed labeling law).
 */
const FinishedGood = model.define("botanical_finished_good", {
  id: model.id().primaryKey(),

  maker_id: model.text(),
  formula_id: model.text(),
  pathway_id: model.text(),
  output_category: model.enum([...OUTPUT_CATEGORIES]),

  batch_number: model.text(),
  sku: model.text(),
  product_name: model.text(),

  quantity_on_hand: model.number().default(0),
  unit_size: model.text().default(""),
  unit_type: model.text().default("unit"),

  manufacture_date: model.dateTime(),
  expiry_date: model.dateTime().nullable(),

  germination_rate: model.float().nullable(),
  germination_test_date: model.dateTime().nullable(),

  status: model.enum([...FINISHED_GOOD_STATUSES]).default("available"),

  is_wholesale_eligible: model.boolean().default(false),
  retail_price_cents: model.number().default(0),
  wholesale_price_cents: model.number().default(0),

  label_approved: model.boolean().default(false),
  coa_required: model.boolean().default(false),
  coa_url: model.text().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["maker_id"], name: "IDX_botanical_finished_good_maker_id" },
    { on: ["pathway_id"], name: "IDX_botanical_finished_good_pathway_id" },
    { on: ["status"], name: "IDX_botanical_finished_good_status" },
    { on: ["sku"], name: "IDX_botanical_finished_good_sku" },
  ])

export default FinishedGood
