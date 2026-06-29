import { Migration } from "@mikro-orm/migrations";

/**
 * Migration: Add `embed_features` to seller_metadata
 *
 * Backs the vendor-controlled toggles on the "My Website" tab that decide which
 * surfaces the FBM Connect embed renders on a vendor's external site
 * (vendor / products / digital / services / events / reviews / booking / chat).
 *
 *  - embed_features : jsonb — array of enabled surface keys. NULL (the default)
 *                             means "all surfaces enabled", so existing embeds
 *                             are unchanged until a vendor saves a selection.
 */
export class Migration20260629AddEmbedFeatures extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      ADD COLUMN IF NOT EXISTS "embed_features" jsonb DEFAULT NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      DROP COLUMN IF EXISTS "embed_features";
    `);
  }
}
