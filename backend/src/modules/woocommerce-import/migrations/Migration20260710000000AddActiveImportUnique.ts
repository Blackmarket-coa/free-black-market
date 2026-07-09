import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Enforce "at most one active import per connection" at the database layer.
 *
 * The route's list-then-create check is a check-then-act race: two POSTs that
 * arrive close together both saw no active import and both started one,
 * doubling the catalog. This partial unique index makes the second insert fail
 * so the route can return 429 instead.
 */
export class Migration20260710000000AddActiveImportUnique extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_woo_import_log_active_per_connection"
        ON "woocommerce_import_log" ("connection_id")
        WHERE "status" IN ('pending', 'in_progress') AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(
      'DROP INDEX IF EXISTS "UQ_woo_import_log_active_per_connection";'
    )
  }
}
