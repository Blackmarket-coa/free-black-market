import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `threshold_mutual_aid_post` and
 * `threshold_karma_ledger_entry`.
 *
 * Threshold is the mutual-aid surface (see
 * `docs/COMPOSITION_LAYER.md`). v1 scaffolds the two core models.
 * The strict no-price invariant lives in `policy.ts` and is asserted
 * at the service entry point — the model itself does not carry a
 * price column.
 */
export class Migration20260513CreateThreshold extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "threshold_mutual_aid_post" (
        "id" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "posted_by_member_id" TEXT NOT NULL,
        "latitude" REAL NULL,
        "longitude" REAL NULL,
        "visibility_radius_km" INTEGER NOT NULL DEFAULT 5,
        "status" TEXT NOT NULL DEFAULT 'active',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "threshold_mutual_aid_post_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_threshold_post_type" ON "threshold_mutual_aid_post" ("type") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_threshold_post_posted_by" ON "threshold_mutual_aid_post" ("posted_by_member_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_threshold_post_status" ON "threshold_mutual_aid_post" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "threshold_karma_ledger_entry" (
        "id" TEXT NOT NULL,
        "member_id" TEXT NOT NULL,
        "post_id" TEXT NULL,
        "delta" INTEGER NOT NULL,
        "reason" TEXT NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "threshold_karma_ledger_entry_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_threshold_karma_member_id" ON "threshold_karma_ledger_entry" ("member_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_threshold_karma_post_id" ON "threshold_karma_ledger_entry" ("post_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "threshold_karma_ledger_entry";`)
    this.addSql(`DROP TABLE IF EXISTS "threshold_mutual_aid_post";`)
  }
}
