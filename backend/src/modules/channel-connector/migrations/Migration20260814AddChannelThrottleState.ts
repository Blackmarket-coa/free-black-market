import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 12 — durable per-connection throttle state.
 *
 * Additive: three nullable/defaulted columns and one index, no data rewritten.
 *
 * The columns exist because the sync jobs are cron-driven and stateless. A
 * backoff held in process memory dies with the run that set it, so the next
 * tick starts calling again regardless — which means, before this, the cron
 * schedule was the only thing limiting request rate. Storing the deadline is
 * what lets a backoff outlive a run and, crucially, be *longer* than the
 * interval between runs.
 *
 * `access_token` is not touched. Encryption at rest is applied in the service
 * at the write path, and existing plaintext values are read through and
 * upgraded on their next write — a migration cannot do it, because the key
 * lives in the process environment and not in the database.
 */
export class Migration20260814AddChannelThrottleState extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "channel_connection"
        ADD COLUMN IF NOT EXISTS "throttled_until" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "needs_reauth" BOOLEAN NOT NULL DEFAULT FALSE;
    `)

    // A negative failure count is meaningless and would make the exponential
    // step run backwards into an instant retry loop. Cheap to forbid outright
    // rather than to defend against at every call site.
    this.addSql(`
      DO $$
      BEGIN
        ALTER TABLE "channel_connection"
          ADD CONSTRAINT "CK_channel_connection_failures"
          CHECK ("consecutive_failures" >= 0);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `)

    // The work list every sync job reads: connections that are enabled and not
    // currently standing down. Partial on `throttled_until IS NULL` would be
    // wrong — a connection whose backoff has expired must come back into the
    // list without anything having rewritten the row.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_connection_throttled"
        ON "channel_connection" ("throttled_until")
        WHERE "enabled" = TRUE AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP INDEX IF EXISTS "IDX_channel_connection_throttled";
    `)
    this.addSql(`
      ALTER TABLE "channel_connection"
        DROP CONSTRAINT IF EXISTS "CK_channel_connection_failures";
    `)
    this.addSql(`
      ALTER TABLE "channel_connection"
        DROP COLUMN IF EXISTS "throttled_until",
        DROP COLUMN IF EXISTS "consecutive_failures",
        DROP COLUMN IF EXISTS "needs_reauth";
    `)
  }
}
