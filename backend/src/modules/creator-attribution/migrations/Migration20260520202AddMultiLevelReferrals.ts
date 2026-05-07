import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 1 / Slice B — multi-level referrals.
 *
 * Additive: new nullable columns + new indexes + the unique constraint on
 * order_attribution.order_id is replaced by a composite unique on
 * (order_id, level) so multiple rows can exist per order (one per
 * referral level) while still guaranteeing uniqueness for a given level.
 *
 * Numbered 20260520202 to land cleanly after the existing
 * 20260520CreateCreatorAttribution migration and the 20260520*
 * commission migrations referenced in docs/AUDIT_DEBT.md (TI-1).
 */
export class Migration20260520202AddMultiLevelReferrals extends Migration {
  async up(): Promise<void> {
    // affiliate_link.referrer_creator_seller_id
    this.addSql(
      'ALTER TABLE "affiliate_link" ADD COLUMN IF NOT EXISTS "referrer_creator_seller_id" TEXT NULL;'
    )
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_affiliate_link_referrer" ON "affiliate_link" ("referrer_creator_seller_id");'
    )

    // order_attribution: per-level columns
    this.addSql(
      'ALTER TABLE "order_attribution" ADD COLUMN IF NOT EXISTS "level" INTEGER NOT NULL DEFAULT 1;'
    )
    this.addSql(
      'ALTER TABLE "order_attribution" ADD COLUMN IF NOT EXISTS "parent_attribution_id" TEXT NULL;'
    )
    this.addSql(
      'ALTER TABLE "order_attribution" ADD COLUMN IF NOT EXISTS "level_split_percent" NUMERIC NULL;'
    )

    // Replace unique(order_id) with unique(order_id, level). Use a guarded
    // sequence so the migration is idempotent and re-runnable. Postgres
    // names auto-generated UNIQUE constraints as "<table>_<col>_key".
    this.addSql(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'order_attribution_order_id_key'
        ) THEN
          ALTER TABLE "order_attribution" DROP CONSTRAINT "order_attribution_order_id_key";
        END IF;
      EXCEPTION WHEN undefined_object THEN null; END $$;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_attribution_order_level"
      ON "order_attribution" ("order_id", "level");
    `)
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_order_attribution_parent" ON "order_attribution" ("parent_attribution_id");'
    )
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_order_attribution_parent";')
    this.addSql('DROP INDEX IF EXISTS "UQ_order_attribution_order_level";')
    this.addSql(
      'ALTER TABLE "order_attribution" DROP COLUMN IF EXISTS "level_split_percent";'
    )
    this.addSql(
      'ALTER TABLE "order_attribution" DROP COLUMN IF EXISTS "parent_attribution_id";'
    )
    this.addSql('ALTER TABLE "order_attribution" DROP COLUMN IF EXISTS "level";')
    this.addSql(
      'ALTER TABLE "order_attribution" ADD CONSTRAINT "order_attribution_order_id_key" UNIQUE ("order_id");'
    )
    this.addSql('DROP INDEX IF EXISTS "IDX_affiliate_link_referrer";')
    this.addSql(
      'ALTER TABLE "affiliate_link" DROP COLUMN IF EXISTS "referrer_creator_seller_id";'
    )
  }
}
