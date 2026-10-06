import { Migration } from "@mikro-orm/migrations"

/**
 * Add the three `raw_<field>` companions `order_payout_breakdown` never got
 * (SD-39).
 *
 * `model.bigNumber()` persists a NUMERIC column plus a `raw_<field>` JSONB
 * companion that the generated CRUD writes on every insert. Three later
 * migrations added the NUMERIC half only — `total_to_plugin_developers` and
 * `total_to_referrers` (Migration20260506200AddPluginAndReferralSplits) and
 * `total_creator_commission` (Migration20260520AddCreatorCommission) — so on
 * a database built from the migrations every `storeOrderBreakdown` insert
 * fails with `column "raw_total_creator_commission" of relation
 * "order_payout_breakdown" does not exist`, and the settlement subscriber
 * swallows it. No order breakdown has ever been storable outside the module
 * test runners, which build the schema from the model instead. Proved on a
 * migrated database by `integration-tests/http/hawala-card-order-settlement
 * .spec.ts`.
 *
 * Nullable JSONB, like `raw_total_donation`: existing rows (there are none
 * that could have been written) need no backfill.
 */
export class Migration20261006AddMissingRawBreakdownColumns extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        ADD COLUMN IF NOT EXISTS "raw_total_creator_commission" JSONB,
        ADD COLUMN IF NOT EXISTS "raw_total_to_plugin_developers" JSONB,
        ADD COLUMN IF NOT EXISTS "raw_total_to_referrers" JSONB;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        DROP COLUMN IF EXISTS "raw_total_to_referrers",
        DROP COLUMN IF EXISTS "raw_total_to_plugin_developers",
        DROP COLUMN IF EXISTS "raw_total_creator_commission";
    `)
  }
}
