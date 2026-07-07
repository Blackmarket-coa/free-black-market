import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260706210821 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vendor_verification" drop constraint if exists "vendor_verification_seller_id_unique";`);
    this.addSql(`create table if not exists "vendor_badge" ("id" text not null, "seller_id" text not null, "badge_type" text check ("badge_type" in ('VERIFIED_PRODUCER', 'LOCAL_PRODUCER', 'ORGANIC_CERTIFIED', 'REGENERATIVE', 'FAIR_TRADE', 'WOMAN_OWNED', 'CONSCIOUS', 'VETERAN_OWNED', 'COOPERATIVE', 'FAMILY_FARM', 'B_CORP', 'ZERO_WASTE', 'CARBON_NEUTRAL', 'COMMUNITY_SUPPORTED')) not null, "status" text check ("status" in ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')) not null default 'PENDING', "display_order" integer not null default 100, "granted_at" timestamptz null, "expires_at" timestamptz null, "granted_by" text null, "documentation_url" text null, "certification_number" text null, "certifying_body" text null, "description" text null, "learn_more_url" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_badge_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_badge_deleted_at" ON "vendor_badge" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_badge_seller_id" ON "vendor_badge" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_badge_type" ON "vendor_badge" ("badge_type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_badge_status" ON "vendor_badge" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_badge_seller_type" ON "vendor_badge" ("seller_id", "badge_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor_verification" ("id" text not null, "seller_id" text not null, "level" text check ("level" in ('UNVERIFIED', 'SELF_REPORTED', 'VERIFIED', 'AUDITED', 'CERTIFIED')) not null default 'UNVERIFIED', "trust_score" integer not null default 0, "years_active" integer not null default 0, "production_scale" text check ("production_scale" in ('HOME_BASED', 'SMALL', 'MEDIUM', 'LARGE')) not null default 'SMALL', "last_verified_at" timestamptz null, "next_verification_due" timestamptz null, "internal_notes" text null, "verification_statement" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_verification_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_verification_seller_id_unique" ON "vendor_verification" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_verification_deleted_at" ON "vendor_verification" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_verification_seller_id" ON "vendor_verification" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_verification_level" ON "vendor_verification" ("level") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_verification_trust_score" ON "vendor_verification" ("trust_score") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "verification_check" ("id" text not null, "vendor_verification_id" text not null, "check_type" text check ("check_type" in ('IDENTITY', 'LOCATION', 'PRODUCTION', 'PRACTICES', 'CERTIFICATION', 'BANK_ACCOUNT', 'TAX_INFO')) not null, "status" text check ("status" in ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'EXPIRED', 'WAIVED')) not null default 'PENDING', "verified_by" text null, "verified_at" timestamptz null, "expires_at" timestamptz null, "documents" jsonb null, "check_data" jsonb null, "notes" text null, "score_contribution" integer not null default 0, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "verification_check_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_verification_check_deleted_at" ON "verification_check" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vcheck_verification_id" ON "verification_check" ("vendor_verification_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vcheck_type" ON "verification_check" ("check_type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vcheck_status" ON "verification_check" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vcheck_expires" ON "verification_check" ("expires_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "vendor_badge" cascade;`);

    this.addSql(`drop table if exists "vendor_verification" cascade;`);

    this.addSql(`drop table if exists "verification_check" cascade;`);
  }

}
