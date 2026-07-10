import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260710020000CreateOdooImport extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "odoo_connection" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL UNIQUE,
        "url" TEXT NOT NULL,
        "db_name" TEXT NOT NULL,
        "username" TEXT NOT NULL,
        "api_key" TEXT NOT NULL,
        "store_name" TEXT NULL,
        "currency" TEXT NULL,
        "last_import_at" TIMESTAMPTZ NULL,
        "last_import_report" JSONB NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "odoo_connection_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_odoo_connection_seller_id"
        ON "odoo_connection" ("seller_id")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "odoo_import_log" (
        "id" TEXT NOT NULL,
        "connection_id" TEXT NOT NULL,
        "status" TEXT CHECK ("status" IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'pending',
        "total_products" INTEGER NOT NULL DEFAULT 0,
        "imported_count" INTEGER NOT NULL DEFAULT 0,
        "updated_count" INTEGER NOT NULL DEFAULT 0,
        "failed_count" INTEGER NOT NULL DEFAULT 0,
        "skipped_count" INTEGER NOT NULL DEFAULT 0,
        "import_as_draft" BOOLEAN NOT NULL DEFAULT true,
        "error_details" JSONB NULL,
        "started_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "odoo_import_log_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_odoo_import_log_connection_id"
        ON "odoo_import_log" ("connection_id")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_odoo_import_log_status"
        ON "odoo_import_log" ("status")
        WHERE "deleted_at" IS NULL;
    `)

    // At most one active import per connection (mirrors the WooCommerce guard).
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_odoo_import_log_active_per_connection"
        ON "odoo_import_log" ("connection_id")
        WHERE "status" IN ('pending', 'in_progress') AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "odoo_import_log" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "odoo_connection" CASCADE;')
  }
}
