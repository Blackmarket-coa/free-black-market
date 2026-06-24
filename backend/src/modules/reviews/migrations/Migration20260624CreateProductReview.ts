import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Create product_review.
 *
 * Verified-purchase reviews. UNIQUE(order_id, product_id) enforces one review
 * per product per order at the DB level.
 */
export class Migration20260624CreateProductReview extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "embed_product_review" (
        "id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "order_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "rating" INTEGER NOT NULL,
        "title" TEXT NULL,
        "body" TEXT NULL,
        "customer_display_name" TEXT NULL,
        "is_verified" BOOLEAN NOT NULL DEFAULT true,
        "status" TEXT NOT NULL DEFAULT 'published',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "embed_product_review_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_embed_product_review_product_id"
      ON "embed_product_review" ("product_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_embed_product_review_seller_id"
      ON "embed_product_review" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_embed_product_review_order_product"
      ON "embed_product_review" ("order_id", "product_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "embed_product_review" CASCADE;')
  }
}
