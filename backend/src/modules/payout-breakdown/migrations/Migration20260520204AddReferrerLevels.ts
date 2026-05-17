import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 1 / Slice B — per-level referrer breakdown column.
 *
 * Additive: single nullable JSONB column on order_payout_breakdown.
 * Numbered 20260520204 to land cleanly after the existing
 * 20260520AddCreatorCommission and 20260506200 migrations.
 */
export class Migration20260520204AddReferrerLevels extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'ALTER TABLE "order_payout_breakdown" ADD COLUMN IF NOT EXISTS "referrer_levels" JSONB NULL;'
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'ALTER TABLE "order_payout_breakdown" DROP COLUMN IF EXISTS "referrer_levels";'
    )
  }
}
