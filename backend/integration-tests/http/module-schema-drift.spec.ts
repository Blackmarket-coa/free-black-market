import { readdirSync, existsSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.setTimeout(300 * 1000)

/**
 * Model / migration drift across every FBM module, on a database built from
 * the migrations exactly as production's is.
 *
 * A model column that no migration created is invisible to every other check
 * FBM runs: `medusa build` and `tsc` type the model, unit specs shadow the
 * writes, and module test runners build their schema FROM the models. It
 * surfaces only when a real insert runs on a migrated database, which is how
 * SD-39's breakdown columns, SD-42's hawala tables, `order_attribution`,
 * SD-50's `character_sheet.raw_*` and the vendor-hype `hype_profile.raw_*`
 * columns were each found — one module at a time. `hawala-schema-drift.spec.ts`
 * walks the hawala ledger; this walks every other module under src/modules.
 *
 * KNOWN_DRIFT is the drift that exists today (2026-11-15), exactly: a table
 * that drifts further, a new model with a missing column, or a fix that is not
 * reflected here all fail. A ratchet — shrink it when a table is fixed; never
 * grow it to make a new model pass.
 */
// Measured 2026-11-15 (SD-63): 38 tables, 94 columns, every one the raw_*
// JSONB companion Medusa writes for a bigNumber field. A missing companion
// makes every insert into that table fail on a migrated database (SD-50 proved
// it for character_sheet), so each line here is a write path that cannot work
// on a database built from the migrations.
const KNOWN_DRIFT: Record<string, string[]> = {
  bargaining_group: ["raw_total_budget"],
  bargaining_member: ["raw_budget"],
  bargaining_proposal: ["raw_total_price", "raw_unit_price"],
  buyer_network: ["raw_min_purchase_commitment", "raw_total_savings"],
  character_sheet: ["raw_capital_deployed_cents", "raw_food_produced_cents"],
  collective_backing: ["raw_amount", "raw_payout_cap_amount", "raw_payout_released_amount"],
  collective_campaign: ["raw_campaign_goal", "raw_funding_goal_override", "raw_investor_backed_amount", "raw_maker_fee", "raw_maker_fee_released_amount", "raw_maker_fee_subtotal", "raw_material_total", "raw_per_unit_backer_cost", "raw_platform_fee_subtotal", "raw_pre_order_backed_amount", "raw_return_cap_multiplier", "raw_shipping_per_unit", "raw_shipping_subtotal", "raw_total_backed_amount", "raw_yield_per_cycle"],
  collective_material_line_item: ["raw_line_total_estimate", "raw_quantity_per_full_campaign", "raw_quantity_per_output_unit", "raw_unit_cost_at_listing"],
  collective_productive_asset_token: ["raw_total_supply"],
  collective_purchase_order: ["raw_actual_amount", "raw_budget_amount"],
  collective_vendor_reputation: ["raw_campaign_cap"],
  collective_yield_report: ["raw_measured_output", "raw_payout_pool_amount", "raw_projected_next_cycle_output"],
  creator_deal: ["raw_total_attributed_cents", "raw_total_paid_out_cents"],
  demand_bounty: ["raw_amount", "raw_amount_paid_out"],
  demand_participant: ["raw_escrow_amount", "raw_price_willing_to_pay"],
  demand_post: ["raw_final_total_price", "raw_final_unit_price", "raw_target_price", "raw_total_bounty_amount", "raw_total_escrowed"],
  donation_disbursement: ["raw_amount"],
  engagement_snapshot: ["raw_comments", "raw_likes", "raw_qualified_views", "raw_saves", "raw_shares", "raw_views", "raw_watch_time_seconds"],
  enterprise_fee: ["raw_amount"],
  garden_membership: ["raw_harvest_credits_balance", "raw_investment_balance", "raw_volunteer_hours_balance", "raw_voting_power"],
  garden_plot: ["raw_season_fee"],
  garden_soil_zone: ["raw_organic_matter_percent", "raw_ph_level"],
  hype_profile: ["raw_capital_need_amount"],
  kitchen: ["raw_deposit_required", "raw_hourly_rate", "raw_monthly_membership_fee"],
  kitchen_equipment: ["raw_current_value", "raw_purchase_price"],
  kitchen_membership: ["raw_deposit_balance", "raw_hours_this_month", "raw_investment_balance", "raw_prepaid_hours_balance", "raw_total_hours_used", "raw_voting_power"],
  kitchen_space: ["raw_daily_rate", "raw_hourly_rate", "raw_monthly_rate", "raw_weekly_rate"],
  network_member: ["raw_total_savings"],
  order_cycle_product: ["raw_override_price"],
  order_subcontract: ["raw_total_cents"],
  prediction_payout_entry: ["raw_payout_amount"],
  prediction_position: ["raw_max_payout_amount", "raw_stake_amount"],
  reward_payout: ["raw_amount_cents", "raw_qualified_views"],
  reward_pool: ["raw_total_cents"],
  service_contract: ["raw_total_paid_cents"],
  share_box: ["raw_total_price"],
  share_box_template: ["raw_base_price"],
  supplier_proposal: ["raw_delivery_cost", "raw_unit_price"],
}

// Walked by its own ratchet, hawala-schema-drift.spec.ts (SD-42).
const EXCLUDED_MODULES = new Set(["hawala-ledger"])

type ParsedProperty = { type?: string; dataType?: { name?: string } }
type DmlModel = {
  schema: Record<string, { parse?: (name: string) => ParsedProperty }>
  parse: () => { tableName: string }
}

const MODULES_DIR = path.resolve(__dirname, "../../src/modules")

function dmlModels(): { module: string; model: DmlModel }[] {
  const out: { module: string; model: DmlModel }[] = []
  for (const mod of readdirSync(MODULES_DIR).sort()) {
    if (EXCLUDED_MODULES.has(mod)) continue
    const index = path.join(MODULES_DIR, mod, "models", "index.ts")
    if (!existsSync(index)) continue
    const exported = require(index) as Record<string, unknown>
    for (const value of Object.values(exported)) {
      const model = value as DmlModel
      if (model && typeof model === "object" && model.schema && typeof model.parse === "function") {
        out.push({ module: mod, model })
      }
    }
  }
  return out
}

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    it("every module model's columns exist on the migrated database, except the recorded drift", async () => {
      const pg = (getContainer() as {
        resolve: (k: string) => { raw: (q: string, b?: unknown[]) => Promise<{ rows: Array<{ column_name: string }> }> }
      }).resolve(ContainerRegistrationKeys.PG_CONNECTION)

      const models = dmlModels()
      // Not a silent cap: if discovery breaks, this fails instead of passing on nothing.
      expect(models.length).toBeGreaterThan(150)

      const drift: Record<string, string[]> = {}
      for (const { model } of models) {
        const table = model.parse().tableName
        const cols = new Set(
          (await pg.raw(`SELECT column_name FROM information_schema.columns WHERE table_name = ?`, [table])).rows.map(
            (r) => r.column_name
          )
        )
        const missing: string[] = []
        if (cols.size === 0) {
          missing.push("<table>")
        } else {
          for (const [prop, def] of Object.entries(model.schema)) {
            const parsed = def?.parse?.(prop)
            if (!parsed) continue
            if (["hasOne", "hasMany", "manyToMany"].includes(String(parsed.type))) continue
            if (parsed.type === "belongsTo") {
              // Medusa snake-cases the foreign key (digitalProduct -> digital_product_id).
              const fk = `${prop.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}_id`
              if (!cols.has(fk) && !cols.has(`${prop}_id`)) missing.push(fk)
              continue
            }
            if (!cols.has(prop)) missing.push(prop)
            if (parsed.dataType?.name === "bigNumber" && !cols.has(`raw_${prop}`)) missing.push(`raw_${prop}`)
          }
          for (const c of ["created_at", "updated_at", "deleted_at"]) if (!cols.has(c)) missing.push(c)
        }
        if (missing.length > 0) drift[table] = [...new Set(missing)]
      }

      const sorted = (r: Record<string, string[]>) =>
        Object.fromEntries(Object.keys(r).sort().map((k) => [k, [...r[k]].sort()]))
      if (JSON.stringify(sorted(drift)) !== JSON.stringify(sorted(KNOWN_DRIFT))) {
        console.log("MODULE_SCHEMA_DRIFT " + JSON.stringify(sorted(drift)))
      }
      expect(sorted(drift)).toEqual(sorted(KNOWN_DRIFT))
    })
  },
})
