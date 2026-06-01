import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration: deduplicate `karma_event` by (source_module, source_id).
 *
 * The existing `IDX_karma_event_source` index is non-unique, so a
 * retried/duplicated system event keyed by the same (source_module,
 * source_id) could double-count karma. This adds a PARTIAL UNIQUE index
 * scoped to rows where `source_id IS NOT NULL` (operator-granted events
 * with a null source_id are intentionally allowed to repeat) and to
 * non-soft-deleted rows.
 */
export class Migration20260601AddKarmaDedup extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_karma_event_source" ON "karma_event" ("source_module", "source_id") WHERE "source_id" IS NOT NULL AND "deleted_at" IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_karma_event_source";`)
  }
}
