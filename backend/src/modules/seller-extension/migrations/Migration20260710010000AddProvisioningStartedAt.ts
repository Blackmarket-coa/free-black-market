import { Migration } from "@mikro-orm/migrations";

/**
 * Migration: Add `provisioning_started_at` to seller_metadata
 *
 * Records when the current Launch provisioning attempt began so the "stuck
 * launch → failed" safety net measures elapsed time from a stable timestamp
 * instead of `updated_at` (which unrelated edits, e.g. saving Connect domains,
 * would reset — restarting the timeout and letting a genuinely stuck site spin
 * forever).
 */
export class Migration20260710010000AddProvisioningStartedAt extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      ADD COLUMN IF NOT EXISTS "provisioning_started_at" timestamptz DEFAULT NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      DROP COLUMN IF EXISTS "provisioning_started_at";
    `);
  }
}
