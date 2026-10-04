import { Migration } from "@mikro-orm/migrations"

/**
 * Shared-goal Coalition campaigns on collective-campaign
 * (docs/BMC_SURVIVAL_PROGRAMS.md Phase 1 item 3).
 *
 * `goal_kind` is a nullable TEXT discriminator, not a value added to
 * `collective_campaign_type_enum`: `ALTER TYPE ... ADD VALUE` cannot run
 * inside the transaction MikroORM wraps a migration in on every Postgres
 * version and the production version is unverified. The two new tables carry
 * INTEGER CENTS (the campaign's own money columns are major units; see
 * `../money.ts`). No balance, accrued or pending-amount column anywhere: the
 * contributed total is a record of what the processor reported on the org's
 * own connected account (Posture A rule 10).
 *
 * `collective_campaign_contribution` is one row per succeeded PaymentIntent per
 * campaign, and its partial unique index on (campaign_id,
 * stripe_payment_intent_id) is the idempotency key for the count: two
 * concurrent webhook deliveries cannot both insert it, so the public total is
 * exactly-once by construction rather than by the order deliveries happen to
 * arrive in. Participant and campaign totals are derived from these rows.
 *
 * Idempotent `up()` (IF NOT EXISTS throughout, partial indexes
 * `WHERE deleted_at IS NULL`) and a full `down()` — the module's two earlier
 * migrations lack one; new ones must have it.
 */
export class Migration20261003SharedGoal extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "collective_campaign"
      ADD COLUMN IF NOT EXISTS "goal_kind" TEXT NULL,
      ADD COLUMN IF NOT EXISTS "cooperative_id" TEXT NULL;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "collective_campaign"
        ADD CONSTRAINT "collective_campaign_goal_kind_check"
          CHECK ("goal_kind" IS NULL OR "goal_kind" IN ('SHARED_GOAL'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_goal_kind"
      ON "collective_campaign" ("goal_kind")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_cooperative_id"
      ON "collective_campaign" ("cooperative_id")
      WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_campaign_participant" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "partner_org_key" TEXT NULL,
        "seller_id" TEXT NULL,
        "role" TEXT NOT NULL,
        "pledged_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "contributed_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_campaign_participant_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "collective_campaign_participant_role_check"
          CHECK ("role" IN ('HOST','COLLECTIVE','PARTNER','SPONSOR')),
        CONSTRAINT "collective_campaign_participant_org_or_seller_check"
          CHECK ("partner_org_key" IS NOT NULL OR "seller_id" IS NOT NULL),
        CONSTRAINT "collective_campaign_participant_pledged_nonneg_check"
          CHECK ("pledged_amount_cents" >= 0),
        CONSTRAINT "collective_campaign_participant_contributed_nonneg_check"
          CHECK ("contributed_amount_cents" >= 0)
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_participant_campaign_id"
      ON "collective_campaign_participant" ("campaign_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_participant_campaign_role"
      ON "collective_campaign_participant" ("campaign_id", "role")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_collective_campaign_participant_campaign_org"
      ON "collective_campaign_participant" ("campaign_id", "partner_org_key")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_collective_campaign_participant_campaign_seller"
      ON "collective_campaign_participant" ("campaign_id", "seller_id")
      WHERE "deleted_at" IS NULL AND "partner_org_key" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_collective_campaign_participant_one_host"
      ON "collective_campaign_participant" ("campaign_id")
      WHERE "deleted_at" IS NULL AND "role" = 'HOST';
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_campaign_milestone" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "target_amount_cents" INTEGER NOT NULL,
        "unit" TEXT NOT NULL DEFAULT 'USD',
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "reached_at" TIMESTAMPTZ NULL,
        "impact_summary" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_campaign_milestone_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "collective_campaign_milestone_target_positive_check"
          CHECK ("target_amount_cents" > 0)
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_milestone_campaign_id"
      ON "collective_campaign_milestone" ("campaign_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_milestone_campaign_order"
      ON "collective_campaign_milestone" ("campaign_id", "sort_order")
      WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_campaign_contribution" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "participant_id" TEXT NOT NULL,
        "partner_org_key" TEXT NOT NULL,
        "stripe_payment_intent_id" TEXT NOT NULL,
        "amount_cents" INTEGER NOT NULL,
        "reversed_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_campaign_contribution_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "collective_campaign_contribution_amount_positive_check"
          CHECK ("amount_cents" > 0)
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_collective_campaign_contribution_campaign_intent"
      ON "collective_campaign_contribution" ("campaign_id", "stripe_payment_intent_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_contribution_campaign_id"
      ON "collective_campaign_contribution" ("campaign_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_contribution_participant_id"
      ON "collective_campaign_contribution" ("participant_id")
      WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_contribution_participant_id";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_contribution_campaign_id";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_collective_campaign_contribution_campaign_intent";`)
    this.addSql(`DROP TABLE IF EXISTS "collective_campaign_contribution";`)

    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_milestone_campaign_order";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_milestone_campaign_id";`)
    this.addSql(`DROP TABLE IF EXISTS "collective_campaign_milestone";`)

    this.addSql(`DROP INDEX IF EXISTS "UQ_collective_campaign_participant_one_host";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_collective_campaign_participant_campaign_seller";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_collective_campaign_participant_campaign_org";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_participant_campaign_role";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_participant_campaign_id";`)
    this.addSql(`DROP TABLE IF EXISTS "collective_campaign_participant";`)

    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_cooperative_id";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_collective_campaign_goal_kind";`)
    this.addSql(`ALTER TABLE "collective_campaign" DROP CONSTRAINT IF EXISTS "collective_campaign_goal_kind_check";`)
    this.addSql(`
      ALTER TABLE "collective_campaign"
      DROP COLUMN IF EXISTS "cooperative_id",
      DROP COLUMN IF EXISTS "goal_kind";
    `)
  }
}
