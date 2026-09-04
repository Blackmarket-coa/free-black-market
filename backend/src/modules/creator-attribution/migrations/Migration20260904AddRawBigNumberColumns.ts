import { Migration } from "@mikro-orm/migrations"

/**
 * `order_attribution` declares three `model.bigNumber()` fields, and Medusa's
 * bigNumber persists each as a NUMERIC column plus a `raw_<field>` JSONB
 * companion that the generated CRUD reads and writes. The create migration
 * only ever made the NUMERIC half, so on a migrated database
 * `createOrderAttributions` / `listOrderAttributions` fail on a column that
 * does not exist — the attribution bridge could not persist a row.
 *
 * Every other bigNumber table in the codebase carries its companions (see the
 * cottage-food and production-costing migrations). This brings this one in
 * line. Nullable, so it is safe on a table that already has rows; the backfill
 * derives each companion from the numeric value it mirrors, and is a no-op on
 * an empty table or on rows already carrying one.
 */
export class Migration20260904AddRawBigNumberColumns extends Migration {
  async up(): Promise<void> {
    for (const field of [
      "attributed_subtotal_cents",
      "commission_basis_cents",
      "commission_amount_cents",
    ]) {
      this.addSql(
        `ALTER TABLE "order_attribution" ADD COLUMN IF NOT EXISTS "raw_${field}" JSONB NULL;`
      )
      this.addSql(`
        UPDATE "order_attribution"
           SET "raw_${field}" = jsonb_build_object('value', "${field}"::text, 'precision', 20)
         WHERE "raw_${field}" IS NULL AND "${field}" IS NOT NULL;
      `)
    }
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "order_attribution" DROP COLUMN IF EXISTS "raw_attributed_subtotal_cents";`)
    this.addSql(`ALTER TABLE "order_attribution" DROP COLUMN IF EXISTS "raw_commission_basis_cents";`)
    this.addSql(`ALTER TABLE "order_attribution" DROP COLUMN IF EXISTS "raw_commission_amount_cents";`)
  }
}
