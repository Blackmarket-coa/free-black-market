import { Migration } from "@mikro-orm/migrations"

/**
 * Document Vault: vendor-uploaded evidence documents (leases, contracts,
 * licenses, insurance, credentials) referenced by quests. Opt-in substrate
 * module; additive and independent of any quest.
 */
export class Migration20260701CreateDocumentVault extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "vault_document_type_enum" AS ENUM ('lease','contract','license','insurance','credential','business_plan','other');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vault_document" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "doc_type" vault_document_type_enum NOT NULL DEFAULT 'other',
        "label" TEXT NOT NULL,
        "file_id" TEXT NULL,
        "issued_at" TIMESTAMPTZ NULL,
        "expires_at" TIMESTAMPTZ NULL,
        "verified" BOOLEAN NOT NULL DEFAULT false,
        "verified_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "vault_document_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vault_document_seller_id" ON "vault_document" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vault_document_doc_type" ON "vault_document" ("doc_type") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "vault_document";`)
    this.addSql(`DROP TYPE IF EXISTS "vault_document_type_enum";`)
  }
}
