import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Create embed_event (connect.js analytics ingestion).
 */
export class Migration20260624CreateEmbedEvent extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "embed_event" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "key_id" TEXT NULL,
        "origin" TEXT NULL,
        "session_id" TEXT NULL,
        "event_type" TEXT NOT NULL,
        "product_id" TEXT NULL,
        "order_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "embed_event_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_embed_event_seller_id"
      ON "embed_event" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_embed_event_seller_type"
      ON "embed_event" ("seller_id", "event_type") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_embed_event_created_at"
      ON "embed_event" ("created_at") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "embed_event" CASCADE;')
  }
}
