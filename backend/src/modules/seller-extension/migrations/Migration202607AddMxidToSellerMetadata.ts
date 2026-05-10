import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Add Matrix `mxid` column to `seller_metadata` per
 * AGGRESSIVE_OPERATIONS_GUIDE.md §2.1 and §5.1.
 *
 * The MXID is the canonical identity for every actor in the BMC ecosystem.
 * Adding it to `seller_metadata` lets vendor-side commerce permissions be
 * derived from Matrix-side governance roles via the entitlements service.
 *
 * The column is nullable while existing vendors are being backfilled (see
 * `scripts/backfill-mxid.ts`). A partial unique index ensures two non-null
 * vendors cannot share the same MXID without preventing legitimate NULLs
 * during the backfill window.
 */
export class Migration202607AddMxidToSellerMetadata extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
        ADD COLUMN IF NOT EXISTS "mxid" TEXT NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_seller_metadata_mxid"
        ON "seller_metadata" ("mxid")
        WHERE "mxid" IS NOT NULL AND "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seller_metadata_mxid"
        ON "seller_metadata" ("mxid");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_seller_metadata_mxid";')
    this.addSql('DROP INDEX IF EXISTS "UQ_seller_metadata_mxid";')
    this.addSql('ALTER TABLE "seller_metadata" DROP COLUMN IF EXISTS "mxid";')
  }
}
