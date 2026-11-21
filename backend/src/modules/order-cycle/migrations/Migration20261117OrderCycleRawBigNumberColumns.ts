import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { addRawBigNumberColumnsSql, type RawCompanion } from "../../../lib/raw-big-number-columns"

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
 * NUMERIC half to `override_price`. Its values, if any, were written for the
 * number that is now `override_price`, so:
 *
 * - only the old name exists (a database built from the migrations): it is
 *   renamed, and its values stay paired with their numbers;
 * - both names exist: each row whose `raw_override_price` is empty beside a
 *   number takes the old column's value, and the old column is left where it
 *   is (nullable, never written by the model);
 * - only the new name exists: nothing to do.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and a schema that already has the columns keeps them: see
 * `lib/raw-big-number-columns.ts`, which also says what happens on a schema
 * it was not written for. Measured, and kept from coming back, by
 * `integration-tests/http/module-schema-drift.spec.ts`.
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

const ADOPT_LEGACY_COMPANION = `
  DO $$
  BEGIN
    IF ${hasColumn("raw_price_override")} THEN
      IF NOT ${hasColumn("raw_override_price")} THEN
        ALTER TABLE "order_cycle_product" RENAME COLUMN "raw_price_override" TO "raw_override_price";
      ELSE
        EXECUTE 'UPDATE "order_cycle_product"
                    SET "raw_override_price" = "raw_price_override"
                  WHERE "raw_override_price" IS NULL
                    AND "raw_price_override" IS NOT NULL
                    AND "override_price" IS NOT NULL';
      END IF;
    END IF;
  END $$;
`

export class Migration20261117OrderCycleRawBigNumberColumns extends Migration {
  override async up(): Promise<void> {
    this.addSql(ADOPT_LEGACY_COMPANION)
    for (const sql of addRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }

  /**
   * Nothing. The columns stay: this migration cannot tell one it added from
   * one the schema already had, and dropping the second kind would destroy
   * values Medusa wrote. Renaming `raw_override_price` back is no safer: on a
   * schema that had it before this migration, that would take the model's
   * own column away. Code that predates the companions does not read them.
   */
  override async down(): Promise<void> {}
}
