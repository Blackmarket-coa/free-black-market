import { Migration } from "@mikro-orm/migrations"

export class Migration20260620CreateContentPlatform extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "platform_account_status_enum" AS ENUM (
          'pending', 'connected', 'reauth_required', 'revoked'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "platform_account" (
        "id" TEXT NOT NULL,
        "creator_seller_id" TEXT NOT NULL,
        "platform" TEXT NOT NULL,
        "external_account_id" TEXT NOT NULL,
        "handle" TEXT NULL,
        "display_name" TEXT NULL,
        "avatar_url" TEXT NULL,
        "follower_count" INTEGER NOT NULL DEFAULT 0,
        "access_token_encrypted" TEXT NULL,
        "refresh_token_encrypted" TEXT NULL,
        "token_expires_at" TIMESTAMPTZ NULL,
        "scopes" JSONB NULL,
        "inbound_webhook_secret" TEXT NULL,
        "webhook_subscription_id" TEXT NULL,
        "status" platform_account_status_enum NOT NULL DEFAULT 'pending',
        "last_synced_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "platform_account_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_platform_account_creator_platform"
        ON "platform_account" ("creator_seller_id", "platform")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_platform_account_external"
        ON "platform_account" ("platform", "external_account_id");
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_platform_account_status"
        ON "platform_account" ("status");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "platform_account" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "platform_account_status_enum" CASCADE;')
  }
}
