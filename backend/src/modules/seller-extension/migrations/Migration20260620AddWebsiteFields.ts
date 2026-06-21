import { Migration } from "@mikro-orm/migrations";

/**
 * Migration: Add FBM Sites ("commerce anywhere") columns to seller_metadata
 *
 * These four columns back the vendor "My Website" tab, which lets a vendor
 * either embed the FBM Connect SDK on their own site (Mode 1 — Connect) or
 * launch a standardized FBM-hosted site (Mode 2 — Launch).
 *
 *  - connect_domains : jsonb  — array of bare hostnames the vendor has
 *                               whitelisted for the Connect SDK. Informational
 *                               + used for optional origin display; the public
 *                               Store API itself stays open (read-only).
 *  - site_status     : text   — launch lifecycle: none | provisioning | live | failed
 *  - site_url        : text   — public URL of the launched site once live
 *  - site_repo       : text   — GitHub repository (org/name) backing the site
 */
export class Migration20260620AddWebsiteFields extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      ADD COLUMN IF NOT EXISTS "connect_domains" jsonb DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "site_status" text NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS "site_url" text DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "site_repo" text DEFAULT NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      DROP COLUMN IF EXISTS "connect_domains",
      DROP COLUMN IF EXISTS "site_status",
      DROP COLUMN IF EXISTS "site_url",
      DROP COLUMN IF EXISTS "site_repo";
    `);
  }
}
