import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Create vendor_embed_key
 *
 * Backs the per-vendor publishable keys used to authenticate connect.js
 * embeds. Only the SHA-256 hash of each key is stored (`key_hash`, unique);
 * the plaintext is shown to the vendor once at creation.
 */
export class Migration20260624CreateVendorEmbedKey extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_embed_key" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "key_hash" TEXT NOT NULL UNIQUE,
        "last_four" TEXT NOT NULL,
        "label" TEXT NULL,
        "revoked_at" TIMESTAMPTZ NULL,
        "last_used_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "vendor_embed_key_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_embed_key_seller_id"
      ON "vendor_embed_key" ("seller_id")
      WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_embed_key_key_hash"
      ON "vendor_embed_key" ("key_hash")
      WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "vendor_embed_key" CASCADE;')
  }
}
