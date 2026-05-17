import { Migration } from "@mikro-orm/migrations"

export class Migration20260505CreateMarketplaceListing extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_listing_status_enum" AS ENUM (
          'draft', 'signing', 'published', 'archived', 'suspended'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_payout_provider_enum" AS ENUM (
          'stripe_connect', 'hawala', 'manual'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_payout_status_enum" AS ENUM (
          'pending', 'active', 'restricted', 'suspended'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "creator_listing" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "manifest" JSONB NOT NULL,
        "code_blob_url" TEXT NULL,
        "code_blob_sha256" TEXT NULL,
        "assets" JSONB NULL,
        "version" TEXT NOT NULL,
        "status" creator_listing_status_enum NOT NULL DEFAULT 'draft',
        "signed_bundle_url" TEXT NULL,
        "signature_envelope" JSONB NULL,
        "signed_at" TIMESTAMPTZ NULL,
        "signing_key_id" TEXT NULL,
        "embed_origins" JSONB NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "creator_listing_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_creator_listing_seller_id"
        ON "creator_listing" ("seller_id");
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_creator_listing_status"
        ON "creator_listing" ("status");
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_creator_listing_seller_slug"
        ON "creator_listing" ("seller_id", "slug")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "creator_payout_account" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL UNIQUE,
        "provider" creator_payout_provider_enum NOT NULL DEFAULT 'manual',
        "external_account_id" TEXT NULL,
        "onboarding_url" TEXT NULL,
        "status" creator_payout_status_enum NOT NULL DEFAULT 'pending',
        "last_payout_at" TIMESTAMPTZ NULL,
        "provider_metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "creator_payout_account_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_creator_payout_account_status"
        ON "creator_payout_account" ("status");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "creator_payout_account" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "creator_listing" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_payout_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_payout_provider_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_listing_status_enum" CASCADE;')
  }
}
