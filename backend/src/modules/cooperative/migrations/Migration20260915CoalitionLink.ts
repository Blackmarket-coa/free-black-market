import { Migration } from "@mikro-orm/migrations"

/**
 * Link a cooperative to a Blackout coalition, and a cooperative member to the
 * MercurJS seller they sell as.
 *
 * `cooperative_member.producer_id` receives two different kinds of id today
 * (a store customer actor id on the self-service join route, a producer row id
 * on the seller launch path), so it cannot resolve a member's catalog. The
 * collective storefront reads `seller_id` instead, which is unambiguous.
 */
export class Migration20260915CoalitionLink extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cooperative"
      ADD COLUMN IF NOT EXISTS "blackout_coalition_id" TEXT NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_cooperative_blackout_coalition"
      ON "cooperative" ("blackout_coalition_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      ALTER TABLE "cooperative"
      ADD COLUMN IF NOT EXISTS "coalition_drives_completed" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "coalition_drive_raised_cents" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "coalition_contributing_members" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "coalition_milestones_at" TIMESTAMPTZ NULL;
    `)
    this.addSql(`
      ALTER TABLE "cooperative_member"
      ADD COLUMN IF NOT EXISTS "seller_id" TEXT NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_cooperative_member_seller"
      ON "cooperative_member" ("seller_id")
      WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_cooperative_member_seller";`)
    this.addSql(`ALTER TABLE "cooperative_member" DROP COLUMN IF EXISTS "seller_id";`)
    this.addSql(`
      ALTER TABLE "cooperative"
      DROP COLUMN IF EXISTS "coalition_milestones_at",
      DROP COLUMN IF EXISTS "coalition_contributing_members",
      DROP COLUMN IF EXISTS "coalition_drive_raised_cents",
      DROP COLUMN IF EXISTS "coalition_drives_completed";
    `)
    this.addSql(`DROP INDEX IF EXISTS "IDX_cooperative_blackout_coalition";`)
    this.addSql(`ALTER TABLE "cooperative" DROP COLUMN IF EXISTS "blackout_coalition_id";`)
  }
}
