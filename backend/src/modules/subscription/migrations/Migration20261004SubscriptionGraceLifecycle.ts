import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * F4 lifecycle (docs/BLACK_MASK_LAUNCH_PLAN.md §5 F4), behind
 * FF_CONSUMER_SUBSCRIPTIONS_V1:
 *
 *   - two statuses, `past_due` (in grace, access continues) and `read_only`
 *     (grace over, read/export kept, nothing deleted). `status` is TEXT with a
 *     CHECK (Migration20260102CreateSubscription), not a Postgres enum, so this
 *     is a DROP + ADD of the CHECK — no ALTER TYPE ADD VALUE;
 *   - nullable `grace_ends_at`, `grace_period_days` (snapshotted when grace
 *     starts), `read_only_at`;
 *   - `expiration_date` may be NULL for an until-canceled subscription.
 *
 * Purely additive for existing rows: every existing status stays legal, the
 * new columns are NULL, and no existing row's expiration_date changes.
 *
 * The status CHECK was declared inline, so Postgres named it
 * `subscription_status_check`. It is dropped by that name AND by a definition
 * match, so a database whose constraint was named differently is still
 * covered and never ends up with two competing CHECKs.
 */
export class Migration20261004SubscriptionGraceLifecycle extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$
      DECLARE c record;
      BEGIN
        FOR c IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'subscription'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%status%'
            AND pg_get_constraintdef(oid) LIKE '%active%'
        LOOP
          EXECUTE format('ALTER TABLE "subscription" DROP CONSTRAINT IF EXISTS %I', c.conname);
        END LOOP;
      END $$;
    `)
    this.addSql(`
      ALTER TABLE "subscription"
        ADD CONSTRAINT "subscription_status_check"
        CHECK ("status" IN ('active', 'paused', 'canceled', 'expired', 'failed', 'past_due', 'read_only'));
    `)

    this.addSql(`ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "grace_ends_at" TIMESTAMPTZ NULL;`)
    this.addSql(`ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "grace_period_days" INTEGER NULL;`)
    this.addSql(`ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "read_only_at" TIMESTAMPTZ NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_grace_ends_at" ON "subscription" (grace_ends_at) WHERE deleted_at IS NULL;`)

    this.addSql(`ALTER TABLE "subscription" ALTER COLUMN "expiration_date" DROP NOT NULL;`)
  }

  /**
   * Reverses only this migration's additions, and refuses to strand data:
   *
   *   - The old CHECK is restored, and the three columns + index dropped, only
   *     when NO row is `past_due` or `read_only`. Otherwise the restore is
   *     skipped with a NOTICE: dropping the CHECK's new values would make those
   *     rows unwritable, and dropping `grace_ends_at` would leave a past_due
   *     row with no end. An operator must move those rows first.
   *   - `expiration_date` regains NOT NULL only when no row holds NULL there.
   */
  async down(): Promise<void> {
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "subscription" WHERE "status" IN ('past_due', 'read_only')
        ) THEN
          RAISE NOTICE 'subscription: rows in past_due/read_only exist; status CHECK and grace columns left in place';
        ELSE
          ALTER TABLE "subscription" DROP CONSTRAINT IF EXISTS "subscription_status_check";
          ALTER TABLE "subscription"
            ADD CONSTRAINT "subscription_status_check"
            CHECK ("status" IN ('active', 'paused', 'canceled', 'expired', 'failed'));
          DROP INDEX IF EXISTS "IDX_subscription_grace_ends_at";
          ALTER TABLE "subscription" DROP COLUMN IF EXISTS "read_only_at";
          ALTER TABLE "subscription" DROP COLUMN IF EXISTS "grace_period_days";
          ALTER TABLE "subscription" DROP COLUMN IF EXISTS "grace_ends_at";
        END IF;
      END $$;
    `)
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "subscription" WHERE "expiration_date" IS NULL) THEN
          RAISE NOTICE 'subscription: until-canceled rows (expiration_date NULL) exist; NOT NULL not restored';
        ELSE
          ALTER TABLE "subscription" ALTER COLUMN "expiration_date" SET NOT NULL;
        END IF;
      END $$;
    `)
  }
}
