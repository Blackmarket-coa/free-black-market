import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `playbook_transition`.
 *
 * Append-only history of playbook changes. `playbook_assignment` is unique by
 * seller and updated in place, so before this table a switch left no record of
 * where the vendor came from.
 *
 * No backfill: existing sellers have exactly one assignment and no known
 * history, and inventing a `from` for them would fabricate transitions that
 * never happened. The table starts empty and fills going forward.
 *
 * See `docs/VENDOR_PROGRESSIONS.md`.
 */
export class Migration20260807000200CreatePlaybookTransition extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "playbook_transition" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "from_recipe_id" TEXT NULL,
        "to_recipe_id" TEXT NOT NULL,
        "kind" TEXT NULL,
        "engines" JSONB NULL,
        "matched_progression" BOOLEAN NOT NULL DEFAULT false,
        "reason" TEXT NULL,
        "stranded_listing_count" INTEGER NOT NULL DEFAULT 0,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "playbook_transition_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_transition_seller_id" ON "playbook_transition" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_transition_to_recipe_id" ON "playbook_transition" ("to_recipe_id") WHERE "deleted_at" IS NULL;`)
    // History is read newest-first per seller on the settings surface.
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_transition_seller_occurred" ON "playbook_transition" ("seller_id", "occurred_at" DESC) WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "playbook_transition";`)
  }
}
