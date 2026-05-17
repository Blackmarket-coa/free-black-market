import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration: add `karma_event` table.
 *
 * Karma is non-fungible and not user-to-user transferable: it accrues
 * from system events tied to a single member. Double-entry ledger
 * semantics don't fit; this table is the per-member event log
 * directly. See `models/karma-event.ts` and `rails.ts` for the rail
 * definition.
 *
 * `account_type` `TIME_BANK` is added to `ledger_account` by the
 * model file alone — `account_type` is stored as TEXT (not a Postgres
 * ENUM) so no DDL change is required.
 */
export class Migration20260513AddKarmaEvent extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "karma_event" (
        "id" TEXT PRIMARY KEY,
        "member_id" TEXT NOT NULL,
        "delta" INTEGER NOT NULL,
        "reason" TEXT NOT NULL,
        "source_module" TEXT,
        "source_id" TEXT,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_karma_event_member_id" ON "karma_event" ("member_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_karma_event_reason" ON "karma_event" ("reason") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_karma_event_source" ON "karma_event" ("source_module", "source_id") WHERE "deleted_at" IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "karma_event" CASCADE;`)
  }
}
