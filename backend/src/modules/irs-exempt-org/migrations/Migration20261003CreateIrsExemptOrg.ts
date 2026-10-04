import { Migration } from "@mikro-orm/migrations"

/**
 * IRS exempt-org ingest: three live tables (one per bulk file), their
 * staging twins, and the per-source snapshot row.
 *
 * Additive; nothing existing is touched. All tables are empty until the
 * first `FF_NONPROFIT_PARITY_V1`-gated ingest runs.
 *
 * Staging tables are UNLOGGED: they hold a file mid-load, are truncated
 * before and after every run, and are never read by a lookup, so WAL for
 * them buys nothing and costs a second copy of ~1.9M rows in the log. The
 * swap (`TRUNCATE live; INSERT INTO live SELECT FROM staging`) runs in one
 * transaction so a failure anywhere leaves the previous snapshot visible.
 *
 * Unique constraints on the soft-deletable live tables are partial indexes
 * `WHERE deleted_at IS NULL`; the staging tables carry a plain unique index
 * because they are the `ON CONFLICT` target of the batch upsert and have no
 * soft-delete column.
 *
 * No `ICO`/`STREET` columns exist anywhere here, on purpose (PII minimisation,
 * docs/BMC_SURVIVAL_PROGRAMS.md §5; recorded in docs/AUDIT_DEBT.md).
 */
export class Migration20261003CreateIrsExemptOrg extends Migration {
  async up(): Promise<void> {
    // --- EO Business Master File -------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "irs_exempt_org" (
        "id" TEXT NOT NULL,
        "ein" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "city" TEXT NULL,
        "state" TEXT NULL,
        "zip5" TEXT NULL,
        "subsection" TEXT NULL,
        "classification" TEXT NULL,
        "ruling" TEXT NULL,
        "deductibility" TEXT NULL,
        "foundation" TEXT NULL,
        "status" TEXT NULL,
        "ntee_cd" TEXT NULL,
        "sort_name" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "irs_exempt_org_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_irs_exempt_org_ein"
        ON "irs_exempt_org" ("ein") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNLOGGED TABLE IF NOT EXISTS "irs_exempt_org_staging" (
        "id" TEXT NOT NULL,
        "ein" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "city" TEXT NULL,
        "state" TEXT NULL,
        "zip5" TEXT NULL,
        "subsection" TEXT NULL,
        "classification" TEXT NULL,
        "ruling" TEXT NULL,
        "deductibility" TEXT NULL,
        "foundation" TEXT NULL,
        "status" TEXT NULL,
        "ntee_cd" TEXT NULL,
        "sort_name" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "irs_exempt_org_staging_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_irs_exempt_org_staging_ein"
        ON "irs_exempt_org_staging" ("ein");
    `)

    // --- Pub 78 Data --------------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "irs_pub78_listing" (
        "id" TEXT NOT NULL,
        "ein" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "city" TEXT NULL,
        "state" TEXT NULL,
        "country" TEXT NULL,
        "deductibility_codes" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "irs_pub78_listing_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_irs_pub78_listing_ein"
        ON "irs_pub78_listing" ("ein") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNLOGGED TABLE IF NOT EXISTS "irs_pub78_listing_staging" (
        "id" TEXT NOT NULL,
        "ein" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "city" TEXT NULL,
        "state" TEXT NULL,
        "country" TEXT NULL,
        "deductibility_codes" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "irs_pub78_listing_staging_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_irs_pub78_listing_staging_ein"
        ON "irs_pub78_listing_staging" ("ein");
    `)

    // --- Automatic Revocation of Exemption List ------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "irs_revocation" (
        "id" TEXT NOT NULL,
        "ein" TEXT NOT NULL,
        "legal_name" TEXT NOT NULL,
        "dba_name" TEXT NULL,
        "city" TEXT NULL,
        "state" TEXT NULL,
        "country" TEXT NULL,
        "exemption_type" TEXT NULL,
        "revocation_date" TIMESTAMPTZ NOT NULL,
        "posting_date" TIMESTAMPTZ NOT NULL,
        "reinstatement_date" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "irs_revocation_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_irs_revocation_ein"
        ON "irs_revocation" ("ein") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNLOGGED TABLE IF NOT EXISTS "irs_revocation_staging" (
        "id" TEXT NOT NULL,
        "ein" TEXT NOT NULL,
        "legal_name" TEXT NOT NULL,
        "dba_name" TEXT NULL,
        "city" TEXT NULL,
        "state" TEXT NULL,
        "country" TEXT NULL,
        "exemption_type" TEXT NULL,
        "revocation_date" TIMESTAMPTZ NOT NULL,
        "posting_date" TIMESTAMPTZ NOT NULL,
        "reinstatement_date" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "irs_revocation_staging_pkey" PRIMARY KEY ("id")
      );
    `)

    // --- Per-source snapshot ------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "irs_ingest_snapshot" (
        "id" TEXT NOT NULL,
        "source" TEXT NOT NULL,
        "as_of" TIMESTAMPTZ NULL,
        "etag" TEXT NULL,
        "sha256" TEXT NULL,
        "row_count" INTEGER NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "started_at" TIMESTAMPTZ NULL,
        "finished_at" TIMESTAMPTZ NULL,
        "error" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "irs_ingest_snapshot_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CK_irs_ingest_snapshot_source"
          CHECK ("source" IN ('pub78', 'revocation', 'eo_bmf')),
        CONSTRAINT "CK_irs_ingest_snapshot_status"
          CHECK ("status" IN ('pending', 'complete', 'failed'))
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_irs_ingest_snapshot_source"
        ON "irs_ingest_snapshot" ("source") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_irs_ingest_snapshot_source";`)
    this.addSql(`DROP TABLE IF EXISTS "irs_ingest_snapshot";`)

    this.addSql(`DROP TABLE IF EXISTS "irs_revocation_staging";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_irs_revocation_ein";`)
    this.addSql(`DROP TABLE IF EXISTS "irs_revocation";`)

    this.addSql(`DROP INDEX IF EXISTS "UQ_irs_pub78_listing_staging_ein";`)
    this.addSql(`DROP TABLE IF EXISTS "irs_pub78_listing_staging";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_irs_pub78_listing_ein";`)
    this.addSql(`DROP TABLE IF EXISTS "irs_pub78_listing";`)

    this.addSql(`DROP INDEX IF EXISTS "UQ_irs_exempt_org_staging_ein";`)
    this.addSql(`DROP TABLE IF EXISTS "irs_exempt_org_staging";`)
    this.addSql(`DROP INDEX IF EXISTS "UQ_irs_exempt_org_ein";`)
    this.addSql(`DROP TABLE IF EXISTS "irs_exempt_org";`)
  }
}
