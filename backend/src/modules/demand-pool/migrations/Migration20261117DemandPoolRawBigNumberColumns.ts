import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { addRawBigNumberColumnsSql, type RawCompanion } from "../../../lib/raw-big-number-columns"

/**
 * SD-63: add the `raw_<field>` companions of the demand-pool module's
 * `model.bigNumber()` fields, which its create migrations never made.
 *
 * Medusa's DML writes a JSONB `raw_<field>` beside every bigNumber's NUMERIC
 * column on each insert, so on a database built from the migrations every
 * insert into `demand_bounty`, `demand_participant`, `demand_post`,
 * `supplier_proposal` failed with `column "raw_<field>" of relation
 * "<table>" does not exist`. No demand post, participant, bounty or supplier
 * proposal could be written, so every demand pool, and every launch (`POST
 * /v1/seller/launches`, the panel's "Launch a Business"), failed.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and the migration is a no-op on a schema that already has the
 * columns: see `lib/raw-big-number-columns.ts`. Measured, and kept from
 * coming back, by `integration-tests/http/module-schema-drift.spec.ts`.
 */
const COLUMNS: RawCompanion[] = [
  ["demand_bounty", "amount", "required"],
  ["demand_bounty", "amount_paid_out", { default: "0" }],
  ["demand_participant", "price_willing_to_pay", "nullable"],
  ["demand_participant", "escrow_amount", { default: "0" }],
  ["demand_post", "target_price", "nullable"],
  ["demand_post", "total_bounty_amount", { default: "0" }],
  ["demand_post", "total_escrowed", { default: "0" }],
  ["demand_post", "final_unit_price", "nullable"],
  ["demand_post", "final_total_price", "nullable"],
  ["supplier_proposal", "unit_price", "required"],
  ["supplier_proposal", "delivery_cost", "nullable"],
]

export class Migration20261117DemandPoolRawBigNumberColumns extends Migration {
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
