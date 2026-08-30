import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration: W4 reviews dedupe (decision D7).
 *
 * `embed_product_review` becomes the marketplace's one review store:
 *
 * 1. Additive columns — `subject_type` (product | seller | service_contract,
 *    default product), service-contract fields (`contract_id`, `program_id`,
 *    `reviewer_seller_id`), and `metadata`; `product_id`/`order_id` become
 *    nullable (seller/service subjects have no product; service subjects
 *    have no order).
 *
 * 2. Partial unique indexes for the two new subjects: one seller review per
 *    order, one service review per (contract, reviewer).
 *
 * 3. Backfill — every `service_review` row (the service-program module's
 *    parallel implementation) is copied in with its original id, so re-runs
 *    are idempotent via ON CONFLICT DO NOTHING. The `service_review` table
 *    itself is left in place, read-only by convention (dropping it is an
 *    operator decision recorded in AUDIT_DEBT §W4).
 */
export class Migration20260830ReviewsAbsorption extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" ADD COLUMN IF NOT EXISTS "subject_type" text NOT NULL DEFAULT 'product';`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" ADD COLUMN IF NOT EXISTS "contract_id" text NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" ADD COLUMN IF NOT EXISTS "program_id" text NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" ADD COLUMN IF NOT EXISTS "reviewer_seller_id" text NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" ALTER COLUMN "product_id" DROP NOT NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" ALTER COLUMN "order_id" DROP NOT NULL;`
    )

    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_embed_review_order_seller"
         ON "embed_product_review" ("order_id", "seller_id")
       WHERE "subject_type" = 'seller' AND "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_embed_review_contract_reviewer"
         ON "embed_product_review" ("contract_id", "reviewer_seller_id")
       WHERE "contract_id" IS NOT NULL AND "deleted_at" IS NULL;`
    )

    // Backfill from the service-program implementation. Guarded on the
    // table's existence because Medusa orders migrations PER MODULE, not by
    // global timestamp — on a fresh database this module can migrate before
    // service-program, and then `service_review` does not exist yet. That
    // world has nothing to copy anyway (both tables empty); on an existing
    // deployment both tables are present and the backfill runs. Original ids
    // preserved — re-running is a no-op.
    this.addSql(
      `DO $backfill$
       BEGIN
         IF to_regclass('"service_review"') IS NOT NULL THEN
           INSERT INTO "embed_product_review"
             ("id", "subject_type", "seller_id", "contract_id", "program_id",
              "reviewer_seller_id", "rating", "body", "is_verified", "status",
              "metadata", "created_at", "updated_at")
           SELECT
             sr."id", 'service_contract', sr."service_seller_id", sr."contract_id",
             sr."program_id", sr."reviewer_id", sr."rating", sr."comment", true,
             'published', sr."metadata", sr."created_at", sr."updated_at"
           FROM "service_review" sr
           WHERE sr."deleted_at" IS NULL
           ON CONFLICT ("id") DO NOTHING;
         END IF;
       END
       $backfill$;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_embed_review_order_seller";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_embed_review_contract_reviewer";`)
    this.addSql(
      `DELETE FROM "embed_product_review" WHERE "subject_type" = 'service_contract';`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" DROP COLUMN IF EXISTS "subject_type";`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" DROP COLUMN IF EXISTS "contract_id";`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" DROP COLUMN IF EXISTS "program_id";`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" DROP COLUMN IF EXISTS "reviewer_seller_id";`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "embed_product_review" DROP COLUMN IF EXISTS "metadata";`
    )
  }
}
