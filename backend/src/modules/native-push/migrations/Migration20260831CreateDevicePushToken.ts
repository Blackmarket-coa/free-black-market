import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Create device_push_token
 *
 * Backs push-notification delivery to the FBM Capacitor shell. One row per
 * FCM registration token; `token` is unique so re-registration updates in
 * place, and `customer_id` is indexed for customer-scoped sends.
 */
export class Migration20260831CreateDevicePushToken extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "device_push_token" (
        "id" TEXT NOT NULL,
        "token" TEXT NOT NULL UNIQUE,
        "platform" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "last_registered_at" TIMESTAMPTZ NULL,
        "disabled_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "device_push_token_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_device_push_token_customer_id"
      ON "device_push_token" ("customer_id")
      WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_device_push_token_token"
      ON "device_push_token" ("token")
      WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "device_push_token" CASCADE;')
  }
}
