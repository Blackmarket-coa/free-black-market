import { Migration } from "@mikro-orm/migrations"

/**
 * Add a seller-scoped addressing column to `entitlement`.
 *
 * The table was customer-shaped: grants are keyed by `customer_id` or
 * `customer_external_id`, and the latter *is* the Matrix mxid — `evaluateAccess`
 * looks up grants exclusively via `listGrantsByMxid`. That makes it unusable for
 * gating vendor features, because a seller is not a customer and
 * `seller_metadata.mxid` is null for essentially every seller (its referenced
 * backfill script does not exist, and Matrix provisioning never writes the mxid
 * back).
 *
 * A dedicated nullable column is used rather than overloading
 * `customer_external_id` with a synthetic `seller:<id>` value. That column is
 * read by the Blackout integration as an mxid; putting seller rows in it would
 * mean any consumer assuming "external id == mxid" silently receives them.
 * `seller_id` is invisible to those code paths — nothing outside the new
 * seller-scoped helpers selects it.
 *
 * Additive and backwards compatible: every existing row keeps `seller_id` NULL
 * and every existing query is unaffected.
 */
export class Migration20260804AddSellerIdToEntitlement extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "entitlement" ADD COLUMN IF NOT EXISTS "seller_id" TEXT NULL;`
    )
    // Supports `verifyForSeller` — the per-request "does this seller hold this
    // feature key" lookup.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_entitlement_seller_feature" ON "entitlement" ("seller_id","feature_key") WHERE "deleted_at" IS NULL;`
    )
    // Supports `listActiveFeatureKeysForSeller` — the gate's single read of
    // every key a seller currently holds.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_entitlement_seller_status" ON "entitlement" ("seller_id","status") WHERE "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_entitlement_seller_status";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_entitlement_seller_feature";`)
    this.addSql(`ALTER TABLE "entitlement" DROP COLUMN IF EXISTS "seller_id";`)
  }
}
