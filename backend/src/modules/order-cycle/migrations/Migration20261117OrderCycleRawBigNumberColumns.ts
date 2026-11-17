import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import {
  addRawBigNumberColumnsSql,
  dropRawBigNumberColumnsSql,
  type RawCompanion,
} from "../../../lib/raw-big-number-columns"

/**
 * SD-63: add the `raw_<field>` companions of the order-cycle module's
 * `model.bigNumber()` fields, which its create migrations never made.
 *
 * Medusa's DML writes a JSONB `raw_<field>` beside every bigNumber's NUMERIC
 * column on each insert, so on a database built from the migrations every
 * insert into `enterprise_fee`, `order_cycle_product`, `share_box`,
 * `share_box_template` failed with `column "raw_<field>" of relation
 * "<table>" does not exist`. No enterprise fee, order-cycle product, share
 * box template or share box could be written, so a vendor could not add a
 * product to an order cycle or create a fee.
 *
 * `order_cycle_product` had the companion under the wrong name:
 * `Migration20251227015616` created the pair as `price_override` /
 * `raw_price_override`, and `Migration20251227174700` renamed only the
 * NUMERIC half to `override_price`. The leftover is renamed rather than left
 * beside a new column, so any value in it stays paired with the number it
 * was written for; a schema that already has `raw_override_price` keeps it,
 * and the leftover (nullable, never written by the model) is left alone.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and the migration is a no-op on a schema that already has the
 * columns: see `lib/raw-big-number-columns.ts`. Measured, and kept from
 * coming back, by `integration-tests/http/module-schema-drift.spec.ts`.
 */
const COLUMNS: RawCompanion[] = [
  ["enterprise_fee", "amount", "required"],
  ["order_cycle_product", "override_price", "nullable"],
  ["share_box", "total_price", "nullable"],
  ["share_box_template", "base_price", "nullable"],
]

const hasColumn = (column: string) => `EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'order_cycle_product'
         AND column_name = '${column}'
    )`

/** Rename `from` to `to` on order_cycle_product when only `from` exists. */
const renameIfOnly = (from: string, to: string) => `
  DO $$
  BEGIN
    IF ${hasColumn(from)} AND NOT ${hasColumn(to)} THEN
      ALTER TABLE "order_cycle_product" RENAME COLUMN "${from}" TO "${to}";
    END IF;
  END $$;
`

export class Migration20261117OrderCycleRawBigNumberColumns extends Migration {
  override async up(): Promise<void> {
    this.addSql(renameIfOnly("raw_price_override", "raw_override_price"))
    for (const sql of addRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }

  override async down(): Promise<void> {
    // Back to what the earlier migrations left: the companion under its old
    // name on order_cycle_product, and none on the other three tables.
    this.addSql(renameIfOnly("raw_override_price", "raw_price_override"))
    for (const sql of dropRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }
}
