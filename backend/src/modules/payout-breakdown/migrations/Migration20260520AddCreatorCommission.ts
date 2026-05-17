import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Add `total_creator_commission` column to `order_payout_breakdown`.
 *
 * The CREATOR_COMMISSION FeeType is already part of the JSON breakdown_items
 * blob; this migration adds an indexed scalar mirror for reporting/rollups.
 * Existing rows default to 0.
 */
export class Migration20260520AddCreatorCommission extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        ADD COLUMN IF NOT EXISTS "total_creator_commission" NUMERIC NOT NULL DEFAULT 0;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "order_payout_breakdown"
        DROP COLUMN IF EXISTS "total_creator_commission";
    `)
  }
}
