import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `refrain_bounty` and `refrain_bounty_submission`.
 *
 * Refrain is the creator-bounty surface (see
 * `docs/COMPOSITION_LAYER.md`). v1 scaffolds the two core models;
 * EscrowAgreement integration and the workflow hooks come in a
 * follow-up branch.
 */
export class Migration20260513CreateRefrain extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "refrain_bounty" (
        "id" TEXT NOT NULL,
        "posted_by_member_id" TEXT NOT NULL,
        "claimed_by_creator_id" TEXT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "amount_minor" NUMERIC NOT NULL,
        "currency_code" TEXT NOT NULL,
        "pricing_mode" TEXT NOT NULL DEFAULT 'fixed',
        "rights_mode" TEXT NOT NULL DEFAULT 'creator_retains',
        "review_window_days" INTEGER NOT NULL DEFAULT 14,
        "status" TEXT NOT NULL DEFAULT 'draft',
        "escrow_agreement_id" TEXT NULL,
        "posted_at" TIMESTAMPTZ NULL,
        "claimed_at" TIMESTAMPTZ NULL,
        "submitted_at" TIMESTAMPTZ NULL,
        "resolved_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "refrain_bounty_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refrain_bounty_posted_by" ON "refrain_bounty" ("posted_by_member_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refrain_bounty_claimed_by" ON "refrain_bounty" ("claimed_by_creator_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refrain_bounty_status" ON "refrain_bounty" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "refrain_bounty_submission" (
        "id" TEXT NOT NULL,
        "bounty_id" TEXT NOT NULL,
        "creator_id" TEXT NOT NULL,
        "deliverable_url" TEXT NULL,
        "notes" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'submitted',
        "reviewed_at" TIMESTAMPTZ NULL,
        "reviewer_note" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "refrain_bounty_submission_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refrain_submission_bounty_id" ON "refrain_bounty_submission" ("bounty_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refrain_submission_creator_id" ON "refrain_bounty_submission" ("creator_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refrain_submission_status" ON "refrain_bounty_submission" ("status") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "refrain_bounty_submission";`)
    this.addSql(`DROP TABLE IF EXISTS "refrain_bounty";`)
  }
}
