import { Migration } from "@mikro-orm/migrations"

export class Migration20260802CreateServiceReview extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "service_review" (
        "id" text NOT NULL,
        "contract_id" text NOT NULL,
        "program_id" text NOT NULL,
        "service_seller_id" text NOT NULL,
        "reviewer_id" text NOT NULL,
        "rating" integer NOT NULL,
        "comment" text NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "service_review_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_service_review_seller"
        ON "service_review" ("service_seller_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_service_review_program"
        ON "service_review" ("program_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_service_review_contract_reviewer"
        ON "service_review" ("contract_id", "reviewer_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "service_review" CASCADE;`)
  }
}
