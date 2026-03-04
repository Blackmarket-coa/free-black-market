import { model } from "@medusajs/framework/utils"

const MaterialLineItem = model.define("collective_material_line_item", {
  id: model.id().primaryKey(),
  campaign_id: model.text(),
  item_name: model.text(),
  supplier_url: model.text(),
  unit_cost_at_listing: model.bigNumber(),
  quantity_per_output_unit: model.bigNumber().default(1),
  quantity_per_full_campaign: model.bigNumber(),
  auto_purchase_supported: model.boolean().default(false),
  line_total_estimate: model.bigNumber().default(0),
  variance_percent: model.float().default(0),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["campaign_id"], name: "IDX_collective_material_campaign_id" },
])

export default MaterialLineItem
