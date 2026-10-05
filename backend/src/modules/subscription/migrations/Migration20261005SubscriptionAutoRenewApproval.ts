import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Affirmative auto-renew approval (Black Mask F2, FF_CONSUMER_SUBSCRIPTIONS_V1;
 * operator answer 2026-10-05, "renew upon approval"):
 *
 *   - `auto_renew_approved` BOOLEAN NOT NULL DEFAULT false — the customer's
 *     current choice;
 *   - `auto_renew_approved_at` TIMESTAMPTZ NULL — when the most recent
 *     approval was given;
 *   - `auto_renew_disclosure_version` TEXT NULL — which disclosure text the
 *     customer saw when approving.
 *
 * Purely additive: every existing row reads "not approved", which is what is
 * true of it — no existing customer ever saw an approval prompt. Nothing reads
 * these columns with the flag off.
 */
export class Migration20261005SubscriptionAutoRenewApproval extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "auto_renew_approved" BOOLEAN NOT NULL DEFAULT false;`
    )
    this.addSql(
      `ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "auto_renew_approved_at" TIMESTAMPTZ NULL;`
    )
    this.addSql(
      `ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "auto_renew_disclosure_version" TEXT NULL;`
    )
  }

  /** Drops only the three columns this migration added. */
  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "subscription" DROP COLUMN IF EXISTS "auto_renew_disclosure_version";`)
    this.addSql(`ALTER TABLE "subscription" DROP COLUMN IF EXISTS "auto_renew_approved_at";`)
    this.addSql(`ALTER TABLE "subscription" DROP COLUMN IF EXISTS "auto_renew_approved";`)
  }
}
