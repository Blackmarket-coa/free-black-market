import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 7 — connect a seller to the organization whose storefront they sell on.
 *
 * Additive and behavior-preserving: nullable column, partial indexes. Nothing
 * connected a seller to a tenancy organization before this, which is why a
 * storefront's tier could not entitle anything for the sellers on it.
 *
 * Mirrors `Migration20260804AddSellerIdToEntitlement` deliberately — same
 * problem (a seller-keyed lookup on a table keyed by something else), so the
 * same shape, including the `WHERE "deleted_at" IS NULL` predicate that keeps
 * soft-deleted rows out of the index.
 */
export class Migration20260810AddSellerIdToMembership extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "tenancy_membership"
        ADD COLUMN IF NOT EXISTS "seller_id" TEXT NULL;
    `)
    // The read this exists for: "which storefronts does this seller sell on".
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_tenancy_membership_seller"
        ON "tenancy_membership" ("seller_id")
        WHERE "seller_id" IS NOT NULL AND "deleted_at" IS NULL;
    `)
    // The uniqueness that matters: one membership per seller per storefront.
    // Not a constraint, because existing rows predate the column and a unique
    // constraint over a nullable column would still admit unlimited nulls —
    // a partial unique index says exactly what is meant and nothing more.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenancy_membership_seller_storefront"
        ON "tenancy_membership" ("seller_id", "storefront_id")
        WHERE "seller_id" IS NOT NULL AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "UQ_tenancy_membership_seller_storefront";')
    this.addSql('DROP INDEX IF EXISTS "IDX_tenancy_membership_seller";')
    this.addSql(
      'ALTER TABLE "tenancy_membership" DROP COLUMN IF EXISTS "seller_id";'
    )
  }
}
