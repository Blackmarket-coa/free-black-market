import { Migration } from "@mikro-orm/migrations"

export class Migration20260804CreateOrderChannel extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "order_channel" (
        "id" text NOT NULL,
        "order_id" text NOT NULL,
        "channel" text CHECK ("channel" IN ('online','pos','vending','pickup','subscription','other')) NOT NULL DEFAULT 'online',
        "source" text NULL,
        "customer_id" text NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "order_channel_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_channel_order"
        ON "order_channel" ("order_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_order_channel_customer"
        ON "order_channel" ("customer_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_order_channel_channel"
        ON "order_channel" ("channel") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "order_channel" CASCADE;`)
  }
}
