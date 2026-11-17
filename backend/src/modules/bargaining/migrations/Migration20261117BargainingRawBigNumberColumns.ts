import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import {
  addRawBigNumberColumnsSql,
  dropRawBigNumberColumnsSql,
  type RawCompanion,
} from "../../../lib/raw-big-number-columns"

/**
 * SD-63: add the `raw_<field>` companions of the bargaining module's
 * `model.bigNumber()` fields, which its create migrations never made.
 *
 * Medusa's DML writes a JSONB `raw_<field>` beside every bigNumber's NUMERIC
 * column on each insert, so on a database built from the migrations every
 * insert into `bargaining_group`, `bargaining_member`, `bargaining_proposal`
 * failed with `column "raw_<field>" of relation "<table>" does not exist`.
 * No bargaining group could be formed, joined or sent a proposal.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and the migration is a no-op on a schema that already has the
 * columns: see `lib/raw-big-number-columns.ts`. Measured, and kept from
 * coming back, by `integration-tests/http/module-schema-drift.spec.ts`.
 */
const COLUMNS: RawCompanion[] = [
  ["bargaining_group", "total_budget", { default: "0" }],
  ["bargaining_member", "budget", { default: "0" }],
  ["bargaining_proposal", "unit_price", "nullable"],
  ["bargaining_proposal", "total_price", "nullable"],
]

export class Migration20261117BargainingRawBigNumberColumns extends Migration {
  override async up(): Promise<void> {
    for (const sql of addRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }

  override async down(): Promise<void> {
    for (const sql of dropRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }
}
