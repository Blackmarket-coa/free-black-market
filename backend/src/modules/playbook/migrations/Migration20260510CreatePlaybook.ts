import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `playbook` and `playbook_assignment` tables.
 *
 * Both tables back the cooperative-economic shape system: `playbook` is
 * a registry of the ten recipes seeded from `backend/src/modules/playbook/
 * recipes/*.ts`, and `playbook_assignment` records which playbook each
 * seller picked along with the picker answers.
 *
 * See `docs/PLAYBOOK_SYSTEM.md`.
 */
export class Migration20260510CreatePlaybook extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "playbook" (
        "id" TEXT NOT NULL,
        "recipe_id" TEXT NOT NULL UNIQUE,
        "display_name" TEXT NOT NULL,
        "social_form" TEXT NOT NULL,
        "storefront_blurb_default" TEXT NOT NULL,
        "commission_rate" REAL NOT NULL DEFAULT 0.03,
        "allow_sliding_scale" BOOLEAN NOT NULL DEFAULT false,
        "allow_credits_payout" TEXT NOT NULL DEFAULT 'true',
        "member_model" TEXT NOT NULL,
        "allowed_listing_types" JSONB NOT NULL,
        "default_features" JSONB NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "playbook_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_recipe_id" ON "playbook" ("recipe_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_is_active" ON "playbook" ("is_active") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "playbook_assignment" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL UNIQUE,
        "playbook_id" TEXT NOT NULL,
        "recipe_id" TEXT NOT NULL,
        "q1_size" TEXT NULL,
        "q2_governance" TEXT NULL,
        "q3_offering" TEXT NULL,
        "recommended_recipe_id" TEXT NULL,
        "overridden" BOOLEAN NOT NULL DEFAULT false,
        "migrated_from" TEXT NULL,
        "assigned_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "playbook_assignment_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_assignment_seller_id" ON "playbook_assignment" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_assignment_playbook_id" ON "playbook_assignment" ("playbook_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_playbook_assignment_recipe_id" ON "playbook_assignment" ("recipe_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "playbook_assignment";`)
    this.addSql(`DROP TABLE IF EXISTS "playbook";`)
  }
}
