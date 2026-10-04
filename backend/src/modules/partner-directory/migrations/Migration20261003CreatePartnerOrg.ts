import { Migration } from "@mikro-orm/migrations"

/**
 * partner_org — pilot-partner records (docs/BMC_SURVIVAL_PROGRAMS.md Phase 1).
 *
 * Shape follows aid-network's Migration20260904CreateAidNetwork: idempotent
 * (`IF NOT EXISTS` / `IF EXISTS`), soft-delete columns, partial unique index
 * `WHERE deleted_at IS NULL`, full `down()`. One deliberate difference: the
 * three vocabularies are TEXT + CHECK constraints rather than native enum
 * types. That is what MikroORM renders for `model.enum` without a
 * `nativeEnumName`, so the table matches the model's own schema, and a later
 * vocabulary change is `DROP CONSTRAINT` / `ADD CONSTRAINT` inside the
 * migration transaction on any Postgres version, where `ALTER TYPE ... ADD
 * VALUE` is version-dependent and the production version is unverified.
 *
 * Column notes — the absences are the point:
 * - no balance / accrued / pending-amount column (Posture A rule 3);
 * - no contact name / email / phone (§5 PII minimisation);
 * - `ein` is TEXT because a leading zero is data;
 * - `verified_as_of` (IRS file date) and `verification_checked_at` (ingest
 *   run) are two columns because legal checkpoint L11 shows the former.
 */
export class Migration20261003CreatePartnerOrg extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "partner_org" (
        "id" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "org_type" TEXT NULL,
        "ein" TEXT NULL,
        "verification_status" TEXT NOT NULL DEFAULT 'unverified',
        "verification_source" TEXT NULL,
        "verified_as_of" TIMESTAMPTZ NULL,
        "verification_checked_at" TIMESTAMPTZ NULL,
        "relationship" TEXT NOT NULL DEFAULT 'standalone',
        "fiscal_host_key" TEXT NULL,
        "stripe_connect_account_id" TEXT NULL,
        "published" BOOLEAN NOT NULL DEFAULT false,
        "url" TEXT NULL,
        "tagline" TEXT NULL,
        "states" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "serves" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "partner_org_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "partner_org_org_type_check"
          CHECK ("org_type" IS NULL OR "org_type" IN ('irs_501c3','irs_501c4','coop','unincorporated')),
        CONSTRAINT "partner_org_verification_status_check"
          CHECK ("verification_status" IN ('unverified','pending','pub78_eligible','bmf_only','not_found','revoked')),
        CONSTRAINT "partner_org_relationship_check"
          CHECK ("relationship" IN ('standalone','fiscal_host','sponsored_collective'))
      );
    `)
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_org_key_unique" ON "partner_org" ("key") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_partner_org_published" ON "partner_org" ("published") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_partner_org_fiscal_host" ON "partner_org" ("fiscal_host_key") WHERE "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_partner_org_fiscal_host";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_partner_org_published";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_partner_org_key_unique";`)
    this.addSql(`DROP TABLE IF EXISTS "partner_org" CASCADE;`)
  }
}
