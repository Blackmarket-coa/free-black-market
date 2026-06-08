import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `kb_article` and `kb_contribution` tables backing the
 * Product Knowledge Base / DIY Library (§14).
 */
export class Migration20260608CreateKnowledgeBase extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "kb_article" (
        "id" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "title" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'DIY',
        "summary" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "category" TEXT NULL,
        "difficulty" TEXT NOT NULL DEFAULT 'Beginner',
        "climate_zone" TEXT NULL,
        "space" TEXT NULL,
        "materials" JSONB NULL,
        "steps" JSONB NULL,
        "related_product_ids" JSONB NULL,
        "author_id" TEXT NULL,
        "contributed_by_community" BOOLEAN NOT NULL DEFAULT false,
        "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
        "upvotes" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "kb_article_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_kb_article_slug" ON "kb_article" ("slug") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_kb_article_type" ON "kb_article" ("type") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_kb_article_category" ON "kb_article" ("category") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_kb_article_status" ON "kb_article" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "kb_contribution" (
        "id" TEXT NOT NULL,
        "submitter_id" TEXT NOT NULL,
        "submitter_type" TEXT NOT NULL DEFAULT 'CUSTOMER',
        "title" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'DIY',
        "payload" JSONB NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "review_note" TEXT NULL,
        "decided_by" TEXT NULL,
        "decided_at" TIMESTAMPTZ NULL,
        "resulting_article_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "kb_contribution_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_kb_contribution_status" ON "kb_contribution" ("status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_kb_contribution_submitter" ON "kb_contribution" ("submitter_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "kb_article";`)
    this.addSql(`DROP TABLE IF EXISTS "kb_contribution";`)
  }
}
