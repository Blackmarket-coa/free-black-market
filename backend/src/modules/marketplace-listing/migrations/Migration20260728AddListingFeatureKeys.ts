import { Migration } from "@mikro-orm/migrations"

/**
 * Adds `feature_keys` to `creator_listing`.
 *
 * A listing needs to declare which Blackout `features.*` entitlement keys a
 * purchase grants — one key (or none) for an individual item, the whole tier
 * bundle for a `subscription_tier` listing. This is the single column that
 * bridges the priced catalog to Blackout's plan-tier entitlement system, so a
 * subscription can fan out into per-feature grants. Nullable so existing
 * listings are untouched.
 */
export class Migration20260728AddListingFeatureKeys extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "creator_listing"
        ADD COLUMN IF NOT EXISTS "feature_keys" JSONB NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "creator_listing"
        DROP COLUMN IF EXISTS "feature_keys";
    `)
  }
}
