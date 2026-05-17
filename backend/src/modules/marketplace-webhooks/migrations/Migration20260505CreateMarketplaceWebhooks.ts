import { Migration } from "@mikro-orm/migrations"

export class Migration20260505CreateMarketplaceWebhooks extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "marketplace_webhook_subscription_status_enum" AS ENUM (
          'active', 'disabled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "marketplace_webhook_delivery_status_enum" AS ENUM (
          'pending', 'succeeded', 'failed', 'dead'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "marketplace_webhook_subscription" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "url" TEXT NOT NULL,
        "secret" TEXT NOT NULL,
        "events" JSONB NOT NULL,
        "status" marketplace_webhook_subscription_status_enum NOT NULL DEFAULT 'active',
        "failure_count" INTEGER NOT NULL DEFAULT 0,
        "last_attempt_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "marketplace_webhook_subscription_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_webhook_subscription_seller_id"
        ON "marketplace_webhook_subscription" ("seller_id");
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_webhook_subscription_status"
        ON "marketplace_webhook_subscription" ("status");
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "marketplace_webhook_delivery" (
        "id" TEXT NOT NULL,
        "subscription_id" TEXT NOT NULL,
        "event" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "attempt" INTEGER NOT NULL DEFAULT 0,
        "status" marketplace_webhook_delivery_status_enum NOT NULL DEFAULT 'pending',
        "response_code" INTEGER NULL,
        "response_body" TEXT NULL,
        "next_attempt_at" TIMESTAMPTZ NULL,
        "delivered_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "marketplace_webhook_delivery_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_webhook_delivery_subscription_id"
        ON "marketplace_webhook_delivery" ("subscription_id");
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_webhook_delivery_status_next"
        ON "marketplace_webhook_delivery" ("status", "next_attempt_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "marketplace_webhook_delivery" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "marketplace_webhook_subscription" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "marketplace_webhook_delivery_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "marketplace_webhook_subscription_status_enum" CASCADE;')
  }
}
