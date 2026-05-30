import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Add `blackout_user_id` to `seller_metadata`.
 *
 * This is the Blackout OAuth `sub` captured at account-link time — the value
 * Blackout uses to key entitlement grants and the `userId` on outbound
 * webhooks. It is distinct from the Matrix `mxid` (which identifies the actor
 * for room/ACL purposes). Nullable until the vendor links their account.
 */
export class Migration20260530AddBlackoutUserId extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
        ADD COLUMN IF NOT EXISTS "blackout_user_id" TEXT NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seller_metadata_blackout_user_id"
        ON "seller_metadata" ("blackout_user_id");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_seller_metadata_blackout_user_id";')
    this.addSql('ALTER TABLE "seller_metadata" DROP COLUMN IF EXISTS "blackout_user_id";')
  }
}
