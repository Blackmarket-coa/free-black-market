import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { addRawBigNumberColumnsSql, type RawCompanion } from "../../../lib/raw-big-number-columns"

/**
 * SD-63: add the `raw_<field>` companions of the order-subcontract module's
 * `model.bigNumber()` fields, which its create migrations never made.
 *
 * Medusa's DML writes a JSONB `raw_<field>` beside every bigNumber's NUMERIC
 * column on each insert, so on a database built from the migrations every
 * insert into `order_subcontract` failed with `column "raw_<field>" of
 * relation "<table>" does not exist`. No order subcontract could be created.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and the migration is a no-op on a schema that already has the
 * columns: see `lib/raw-big-number-columns.ts`. Measured, and kept from
 * coming back, by `integration-tests/http/module-schema-drift.spec.ts`.
 */
const COLUMNS: RawCompanion[] = [
  ["order_subcontract", "total_cents", "required"],
]

export class Migration20261117OrderSubcontractRawBigNumberColumns extends Migration {
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
