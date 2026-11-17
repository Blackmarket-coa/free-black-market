import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import {
  addRawBigNumberColumnsSql,
  dropRawBigNumberColumnsSql,
  type RawCompanion,
} from "../../../lib/raw-big-number-columns"

/**
 * SD-63: add the `raw_<field>` companions of the kitchen module's
 * `model.bigNumber()` fields, which its create migrations never made.
 *
 * Medusa's DML writes a JSONB `raw_<field>` beside every bigNumber's NUMERIC
 * column on each insert, so on a database built from the migrations every
 * insert into `kitchen`, `kitchen_space`, `kitchen_equipment`,
 * `kitchen_membership` failed with `column "raw_<field>" of relation
 * "<table>" does not exist`. No kitchen, space, piece of equipment or
 * membership could be created.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and the migration is a no-op on a schema that already has the
 * columns: see `lib/raw-big-number-columns.ts`. Measured, and kept from
 * coming back, by `integration-tests/http/module-schema-drift.spec.ts`.
 */
const COLUMNS: RawCompanion[] = [
  ["kitchen", "hourly_rate", "nullable"],
  ["kitchen", "monthly_membership_fee", "nullable"],
  ["kitchen", "deposit_required", "nullable"],
  ["kitchen_space", "hourly_rate", "nullable"],
  ["kitchen_space", "daily_rate", "nullable"],
  ["kitchen_space", "weekly_rate", "nullable"],
  ["kitchen_space", "monthly_rate", "nullable"],
  ["kitchen_equipment", "purchase_price", "nullable"],
  ["kitchen_equipment", "current_value", "nullable"],
  ["kitchen_membership", "prepaid_hours_balance", { default: "0" }],
  ["kitchen_membership", "deposit_balance", { default: "0" }],
  ["kitchen_membership", "investment_balance", { default: "0" }],
  ["kitchen_membership", "total_hours_used", { default: "0" }],
  ["kitchen_membership", "hours_this_month", { default: "0" }],
  ["kitchen_membership", "voting_power", { default: "1" }],
]

export class Migration20261117KitchenRawBigNumberColumns extends Migration {
  override async up(): Promise<void> {
    for (const sql of addRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }

  override async down(): Promise<void> {
    for (const sql of dropRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }
}
