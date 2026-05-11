import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration: add fiscal-sponsor fields to `donation_settings`.
 *
 * Posture A routes all donations through a 501(c)(3) fiscal sponsor.
 * The fiscal sponsor handles state charity registration (~40 states)
 * and issues donor receipts; FBM is a routing layer.
 *
 * See `docs/POSTURE_A_COMPLIANCE.md`.
 */
export class Migration20260510AddFiscalSponsor extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "donation_settings" ADD COLUMN IF NOT EXISTS "fiscal_sponsor_name" TEXT NULL;`)
    this.addSql(`ALTER TABLE "donation_settings" ADD COLUMN IF NOT EXISTS "fiscal_sponsor_account_id" TEXT NULL;`)
    this.addSql(`ALTER TABLE "donation_settings" ADD COLUMN IF NOT EXISTS "fiscal_sponsor_url" TEXT NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "donation_settings" DROP COLUMN IF EXISTS "fiscal_sponsor_url";`)
    this.addSql(`ALTER TABLE "donation_settings" DROP COLUMN IF EXISTS "fiscal_sponsor_account_id";`)
    this.addSql(`ALTER TABLE "donation_settings" DROP COLUMN IF EXISTS "fiscal_sponsor_name";`)
  }
}
