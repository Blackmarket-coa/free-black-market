import { Migration } from "@mikro-orm/migrations"

/**
 * Add `total_donation` to `order_payout_breakdown`.
 *
 * The DONATION FeeType is carried in the `breakdown_items` JSON blob; this is
 * its scalar mirror for reporting, alongside `total_tip`. Existing rows default
 * to 0 — no live caller passes a donation to `calculateBreakdown` yet, so the
 * column is additive and dormant.
 *
 * `model.bigNumber()` persists a NUMERIC column plus a `raw_<field>` JSONB
 * companion that the generated CRUD reads and writes; the base table carries
 * one for every bigNumber field (Migration20260101000000), and
 * creator-attribution's Migration20260904AddRawBigNumberColumns records what
 * happens when the companion is missing. Both halves are added here.
 */
export class Migration20261003AddTotalDonation extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        ADD COLUMN IF NOT EXISTS "total_donation" NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "raw_total_donation" JSONB;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        DROP COLUMN IF EXISTS "raw_total_donation",
        DROP COLUMN IF EXISTS "total_donation";
    `)
  }
}
