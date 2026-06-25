import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Consolidate reviews onto the platform `review` model.
 *
 * The original `embed_product_review` table stored a full parallel copy of
 * rating/comment data that now lives in the platform `@mercurjs/reviews`
 * `review` model. It is replaced by the thin `embed_review_detail`, which holds
 * only the embed-specific extras (title, public author name, verified flag,
 * moderation status) keyed 1:1 by `review_id`, plus denormalized
 * seller_id/product_id routing keys.
 *
 * No data backfill: the reviews feature has no production rows yet, so the old
 * table is dropped rather than migrated.
 */
export class Migration20260625ConsolidateEmbedReviews extends Migration {
  async up(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "embed_product_review" CASCADE;')

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "embed_review_detail" (
        "id" TEXT NOT NULL,
        "review_id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL,
        "title" TEXT NULL,
        "customer_display_name" TEXT NULL,
        "is_verified" BOOLEAN NOT NULL DEFAULT true,
        "status" TEXT NOT NULL DEFAULT 'published',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "embed_review_detail_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_embed_review_detail_review_id"
      ON "embed_review_detail" ("review_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_embed_review_detail_seller_id"
      ON "embed_review_detail" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_embed_review_detail_product_id"
      ON "embed_review_detail" ("product_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "embed_review_detail" CASCADE;')
  }
}
