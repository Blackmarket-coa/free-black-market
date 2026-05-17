import { Migration } from "@mikro-orm/migrations"

/**
 * Add plugin-developer and referral split columns to PayoutConfig and
 * mirror them as scalar totals on OrderPayoutBreakdown. Existing rows
 * default to 0 — no behavioral change until config values are set.
 */
export class Migration20260506200AddPluginAndReferralSplits extends Migration {
  async up(): Promise<void> {
    // Table is owned by the hawala-ledger module (created in
    // Migration20251229CreateHawalaLedger as "hawala_payout_config").
    // Cross-module ALTER is safe under timestamp ordering — the
    // hawala migration runs first.
    this.addSql(`
      ALTER TABLE "hawala_payout_config"
        ADD COLUMN IF NOT EXISTS "plugin_developer_percent" NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "referral_percent" NUMERIC NOT NULL DEFAULT 0;
    `)
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        ADD COLUMN IF NOT EXISTS "total_to_plugin_developers" NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "total_to_referrers" NUMERIC NOT NULL DEFAULT 0;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_payout_config"
        DROP COLUMN IF EXISTS "plugin_developer_percent",
        DROP COLUMN IF EXISTS "referral_percent";
    `)
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        DROP COLUMN IF EXISTS "total_to_plugin_developers",
        DROP COLUMN IF EXISTS "total_to_referrers";
    `)
  }
}
