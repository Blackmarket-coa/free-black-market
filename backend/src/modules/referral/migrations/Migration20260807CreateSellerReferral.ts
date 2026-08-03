import { Migration } from "@mikro-orm/migrations"

/**
 * Create the generic seller-referral table.
 *
 * Additive; nothing existing is touched. This is the attribution record the
 * `REFERRAL_FEE` fee type has always described but never had — creator
 * referrals fund `CREATOR_COMMISSION` through `creator-attribution`, but a
 * seller referring another seller onto the platform had nowhere to be recorded,
 * so `payout_config.referral_percent` read nowhere.
 *
 * Enum-ish columns are TEXT + CHECK rather than Postgres enums, matching
 * `Migration20260806CreateVendorCharge` and for the same reason: adding a value
 * to a real enum cannot be done in the same migration batch that uses it.
 *
 * Two guards live in the schema, not just the service:
 *   - `IDX_seller_referral_referred` (partial-unique) — a seller is referred at
 *     most once, so a re-recorded attribution collides instead of forking the
 *     share. `WHERE deleted_at IS NULL` so a soft delete releases the identity.
 *   - `CK_seller_referral_not_self` — a seller can never be recorded as their
 *     own referrer, closing the self-payout laundering shape at the last line
 *     of defence.
 */
export class Migration20260807CreateSellerReferral extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "seller_referral" (
        "id" TEXT NOT NULL,
        "referred_seller_id" TEXT NOT NULL,
        "referrer_seller_id" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active',
        "source" TEXT NOT NULL,
        "attributed_at" TIMESTAMPTZ NOT NULL,
        "expires_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_seller_referral" PRIMARY KEY ("id"),
        CONSTRAINT "CK_seller_referral_status" CHECK (
          "status" IN ('active', 'expired', 'revoked')
        ),
        CONSTRAINT "CK_seller_referral_source" CHECK (
          "source" IN ('self', 'admin', 'signup_code', 'migration')
        ),
        CONSTRAINT "CK_seller_referral_not_self" CHECK (
          "referred_seller_id" <> "referrer_seller_id"
        )
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seller_referral_referred"
        ON "seller_referral" ("referred_seller_id") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seller_referral_referrer_status"
        ON "seller_referral" ("referrer_seller_id", "status") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_seller_referral_referrer_status";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_seller_referral_referred";`)
    this.addSql(`DROP TABLE IF EXISTS "seller_referral";`)
  }
}
