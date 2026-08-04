import { Migration } from "@mikro-orm/migrations"

/**
 * Record how much each vault document actually occupies.
 *
 * Additive: one nullable column. NULL means **unknown**, not zero — existing
 * rows predate any measurement, and a size lookup can fail for a live one too
 * (`shared/file-size.ts`). Only known sizes count toward the plan's storage
 * cap, so a backfill is optional rather than a prerequisite: without one, every
 * existing document contributes nothing and no seller is retroactively pushed
 * over a quota by a column that just appeared.
 *
 * BIGINT rather than INTEGER: a single upload can exceed INTEGER's ~2.1 GB
 * ceiling on its own, and the Scale tier's quota is 50 GB. Same reasoning as
 * the usage counter's quantity column.
 */
export class Migration20260811AddVaultDocumentBytes extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "vault_document"
        ADD COLUMN IF NOT EXISTS "bytes_stored" BIGINT NULL;
    `)
    // A negative size is a bug in whatever wrote it, not a small file.
    this.addSql(`
      ALTER TABLE "vault_document"
        DROP CONSTRAINT IF EXISTS "CK_vault_document_bytes_stored";
    `)
    this.addSql(`
      ALTER TABLE "vault_document"
        ADD CONSTRAINT "CK_vault_document_bytes_stored"
        CHECK ("bytes_stored" IS NULL OR "bytes_stored" >= 0);
    `)
    // The read this exists for: sum a seller's stored bytes.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vault_document_seller_bytes"
        ON "vault_document" ("seller_id")
        WHERE "bytes_stored" IS NOT NULL AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_vault_document_seller_bytes";')
    this.addSql(
      'ALTER TABLE "vault_document" DROP CONSTRAINT IF EXISTS "CK_vault_document_bytes_stored";'
    )
    this.addSql(
      'ALTER TABLE "vault_document" DROP COLUMN IF EXISTS "bytes_stored";'
    )
  }
}
