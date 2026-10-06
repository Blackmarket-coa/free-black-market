import { Migration } from "@mikro-orm/migrations"

/**
 * Blackout subscription manage sessions (operator answer 2026-10-06, item 21).
 *
 * Backing table for `POST /v1/integrations/blackout/commerce/subscriptions/manage-sessions`
 * and its hosted page. Only the sha256 of the URL token is stored. The partial
 * unique index on `blackout_user_id` WHERE `revoked_at` IS NULL is what makes
 * "a new mint revokes the earlier ones" hold under concurrency: a second live
 * row for the same member cannot be written.
 *
 * down() drops only what up() added: this table and its two indexes.
 */
export class Migration20261006CreateBlackoutManageSession extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "blackout_manage_session" (
        "id" TEXT NOT NULL,
        "blackout_user_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "token_hash" TEXT NOT NULL,
        "csrf_nonce_hash" TEXT NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ NULL,
        "return_url" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "blackout_manage_session_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_blackout_manage_session_token_hash"
        ON "blackout_manage_session" ("token_hash")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_blackout_manage_session_live_user"
        ON "blackout_manage_session" ("blackout_user_id")
        WHERE "revoked_at" IS NULL AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_blackout_manage_session_live_user";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_blackout_manage_session_token_hash";`)
    this.addSql(`DROP TABLE IF EXISTS "blackout_manage_session";`)
  }
}
