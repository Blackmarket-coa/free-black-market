import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `plugin_version` — immutable per-version history behind
 * `plugin_listing` (W3 registry bridge; see docs/contracts/extension-manifest.md).
 */
export class Migration20260829CreatePluginVersion extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "plugin_version" (
        "id" TEXT NOT NULL,
        "plugin_listing_id" TEXT NULL,
        "slug" TEXT NOT NULL,
        "version" TEXT NOT NULL,
        "min_host_version" TEXT NULL,
        "max_host_version" TEXT NULL,
        "manifest" JSONB NULL,
        "manifest_url" TEXT NULL,
        "signed_bundle_url" TEXT NULL,
        "signature_envelope" JSONB NULL,
        "signing_key_id" TEXT NULL,
        "code_sha256" TEXT NULL,
        "source_listing_id" TEXT NULL,
        "published_at" TIMESTAMPTZ NOT NULL,
        "yanked_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "plugin_version_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_plugin_version_slug_version" ON "plugin_version" ("slug", "version") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_plugin_version_slug" ON "plugin_version" ("slug") WHERE "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "plugin_version";`)
  }
}
