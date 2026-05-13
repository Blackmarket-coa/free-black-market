import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260513CreateSellSignup extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "sell_signup" (
        "id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "store_name" TEXT NOT NULL,
        "selling" JSONB NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'new'
          CHECK ("status" IN ('new', 'contacted', 'converted', 'rejected')),
        "source_ip" TEXT NULL,
        "user_agent" TEXT NULL,
        "referer" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "sell_signup_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_sell_signup_email"
        ON "sell_signup" ("email")
        WHERE deleted_at IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_sell_signup_status_created"
        ON "sell_signup" ("status", "created_at" DESC)
        WHERE deleted_at IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "sell_signup" CASCADE;`)
  }
}
