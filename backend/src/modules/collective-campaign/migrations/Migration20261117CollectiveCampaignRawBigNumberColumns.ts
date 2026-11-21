import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { addRawBigNumberColumnsSql, type RawCompanion } from "../../../lib/raw-big-number-columns"

/**
 * SD-63: add the `raw_<field>` companions of the collective-campaign module's
 * `model.bigNumber()` fields, which its create migrations never made.
 *
 * Medusa's DML writes a JSONB `raw_<field>` beside every bigNumber's NUMERIC
 * column on each insert, so on a database built from the migrations every
 * insert into `collective_backing`, `collective_campaign`,
 * `collective_material_line_item`, `collective_productive_asset_token`,
 * `collective_purchase_order`, `collective_vendor_reputation`,
 * `collective_yield_report` failed with `column "raw_<field>" of relation
 * "<table>" does not exist`. No collective campaign, backing, material line,
 * purchase order, asset token, vendor reputation or yield report could be
 * written.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and the migration is a no-op on a schema that already has the
 * columns: see `lib/raw-big-number-columns.ts`. Measured, and kept from
 * coming back, by `integration-tests/http/module-schema-drift.spec.ts`.
 */
const COLUMNS: RawCompanion[] = [
  ["collective_backing", "amount", "required"],
  ["collective_backing", "payout_cap_amount", "nullable"],
  ["collective_backing", "payout_released_amount", { default: "0" }],
  ["collective_campaign", "funding_goal_override", "nullable"],
  ["collective_campaign", "maker_fee", { default: "0" }],
  ["collective_campaign", "shipping_per_unit", { default: "0" }],
  ["collective_campaign", "return_cap_multiplier", { default: "2" }],
  ["collective_campaign", "yield_per_cycle", "nullable"],
  ["collective_campaign", "material_total", { default: "0" }],
  ["collective_campaign", "maker_fee_subtotal", { default: "0" }],
  ["collective_campaign", "platform_fee_subtotal", { default: "0" }],
  ["collective_campaign", "shipping_subtotal", { default: "0" }],
  ["collective_campaign", "campaign_goal", { default: "0" }],
  ["collective_campaign", "per_unit_backer_cost", { default: "0" }],
  ["collective_campaign", "total_backed_amount", { default: "0" }],
  ["collective_campaign", "pre_order_backed_amount", { default: "0" }],
  ["collective_campaign", "investor_backed_amount", { default: "0" }],
  ["collective_campaign", "maker_fee_released_amount", { default: "0" }],
  ["collective_material_line_item", "unit_cost_at_listing", "required"],
  ["collective_material_line_item", "quantity_per_output_unit", { default: "1" }],
  ["collective_material_line_item", "quantity_per_full_campaign", "required"],
  ["collective_material_line_item", "line_total_estimate", { default: "0" }],
  ["collective_productive_asset_token", "total_supply", "required"],
  ["collective_purchase_order", "budget_amount", "required"],
  ["collective_purchase_order", "actual_amount", "nullable"],
  ["collective_vendor_reputation", "campaign_cap", "nullable"],
  ["collective_yield_report", "measured_output", "required"],
  ["collective_yield_report", "payout_pool_amount", { default: "0" }],
  ["collective_yield_report", "projected_next_cycle_output", "nullable"],
]

export class Migration20261117CollectiveCampaignRawBigNumberColumns extends Migration {
  override async up(): Promise<void> {
    for (const sql of addRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }

  /**
   * Nothing. The columns stay: this migration cannot tell one it added from
   * one the schema already had, and dropping the second kind would destroy
   * values Medusa wrote. Code that predates them does not read them.
   */
  override async down(): Promise<void> {}
}
