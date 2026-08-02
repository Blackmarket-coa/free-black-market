import { Migration } from "@mikro-orm/migrations"

/**
 * Create the vendor billing-plan tables.
 *
 * Three tables, all additive — nothing existing is touched:
 *
 *   vendor_plan             the plan ladder (denormalized from catalog.ts)
 *   vendor_plan_assignment  one row per seller; the state machine
 *   vendor_plan_event       append-only history AND the idempotency table
 *
 * Enum-ish columns are TEXT + CHECK rather than Postgres enums, deliberately.
 * Adding a value to a real enum cannot be done in the same migration batch that
 * uses it (see `Migration20260802AddGeneralVendorType` for the full finding), so
 * a CHECK constraint keeps future plan/status additions to a single ordinary
 * migration.
 */
export class Migration20260805CreateVendorPlan extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_plan" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "display_name" TEXT NOT NULL,
        "description" TEXT NULL,
        "price_amount" INTEGER NOT NULL DEFAULT 0,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "interval" TEXT NOT NULL DEFAULT 'month' CHECK ("interval" IN ('month','year','none')),
        "platform_fee_percent" REAL NULL,
        "trial_days" INTEGER NOT NULL DEFAULT 0,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "is_public" BOOLEAN NOT NULL DEFAULT true,
        "display_order" INTEGER NOT NULL DEFAULT 0,
        "feature_keys" JSONB NULL,
        "stripe_price_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "vendor_plan_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_plan_code" ON "vendor_plan" ("code") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_vendor_plan_is_active" ON "vendor_plan" ("is_active") WHERE "deleted_at" IS NULL;`
    )

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_plan_assignment" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "plan_code" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('trialing','active','past_due','canceled')),
        "current_period_start" TIMESTAMPTZ NULL,
        "current_period_end" TIMESTAMPTZ NULL,
        "trial_ends_at" TIMESTAMPTZ NULL,
        "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
        "pending_plan_code" TEXT NULL,
        "pending_effective_at" TIMESTAMPTZ NULL,
        "started_at" TIMESTAMPTZ NULL,
        "activated_at" TIMESTAMPTZ NULL,
        "canceled_at" TIMESTAMPTZ NULL,
        "dunning_attempts" INTEGER NOT NULL DEFAULT 0,
        "next_retry_at" TIMESTAMPTZ NULL,
        "stripe_customer_id" TEXT NULL,
        "last_payment_intent_id" TEXT NULL,
        "assigned_by" TEXT NOT NULL DEFAULT 'system' CHECK ("assigned_by" IN ('system','admin','self','migration')),
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "vendor_plan_assignment_pkey" PRIMARY KEY ("id")
      );
    `)
    // One live assignment per seller. This uniqueness is what makes
    // `ensureAssignment` safe under concurrent provisioning.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_plan_assignment_seller_id" ON "vendor_plan_assignment" ("seller_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_vendor_plan_assignment_status_period" ON "vendor_plan_assignment" ("status","current_period_end") WHERE "deleted_at" IS NULL;`
    )
    // Partial on pending_plan_code so the due-changes sweep scans only the
    // handful of rows with a scheduled downgrade.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_vendor_plan_assignment_pending" ON "vendor_plan_assignment" ("pending_effective_at") WHERE "deleted_at" IS NULL AND "pending_plan_code" IS NOT NULL;`
    )

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_plan_event" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "assignment_id" TEXT NOT NULL,
        "type" TEXT NOT NULL CHECK ("type" IN ('assigned','upgraded','downgraded','canceled','renewed','payment_succeeded','payment_failed','reconciled')),
        "from_plan_code" TEXT NULL,
        "to_plan_code" TEXT NULL,
        "idempotency_key" TEXT NULL,
        "payload" JSONB NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "vendor_plan_event_pkey" PRIMARY KEY ("id")
      );
    `)
    // The load-bearing constraint: this is what makes a replayed webhook or
    // re-fired cron a no-op instead of a double transition.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_plan_event_idem" ON "vendor_plan_event" ("idempotency_key") WHERE "deleted_at" IS NULL AND "idempotency_key" IS NOT NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_vendor_plan_event_seller" ON "vendor_plan_event" ("seller_id","occurred_at") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_vendor_plan_event_assignment" ON "vendor_plan_event" ("assignment_id") WHERE "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "vendor_plan_event";`)
    this.addSql(`DROP TABLE IF EXISTS "vendor_plan_assignment";`)
    this.addSql(`DROP TABLE IF EXISTS "vendor_plan";`)
  }
}
