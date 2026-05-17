import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create the seven asset-graph tables.
 *
 *   asset_kind          taxonomy nodes seeded from seed/asset-kinds.ts
 *   asset_declaration   member-side intake (what a member has/offers)
 *   attestation         verification claim attached to a declaration
 *   project_manifest    vertical recipe seeded from manifests/
 *   project_instance    deployment of a manifest in a place
 *   match_proposal      matcher output (engine lands in v0.1)
 *   settlement_record   project-scoped wrapper around a hawala-ledger entry
 *
 * See `docs/ASSET_GRAPH.md`. The catalog tables (`asset_kind`,
 * `project_manifest`) are seeded from the in-code source of truth by
 * `backend/src/scripts/seed-asset-graph.ts`.
 */
export class Migration20260512CreateAssetGraph extends Migration {
  async up(): Promise<void> {
    // ── asset_kind ────────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "asset_kind" (
        "id" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "category" TEXT NOT NULL,
        "parent_slug" TEXT NULL,
        "display_name" TEXT NOT NULL,
        "attribute_schema" JSONB NOT NULL,
        "default_sensitivity_tier" TEXT NOT NULL,
        "default_lifecycle" TEXT NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "asset_kind_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_kind_slug" ON "asset_kind" ("slug") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_kind_category" ON "asset_kind" ("category") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_kind_parent_slug" ON "asset_kind" ("parent_slug") WHERE "deleted_at" IS NULL;`
    )

    // ── asset_declaration ────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "asset_declaration" (
        "id" TEXT NOT NULL,
        "member_id" TEXT NOT NULL,
        "asset_kind_id" TEXT NOT NULL,
        "kind_slug" TEXT NOT NULL,
        "attributes" JSONB NOT NULL,
        "sensitivity_tier" TEXT NOT NULL,
        "lifecycle" TEXT NOT NULL,
        "availability" JSONB NULL,
        "geography" JSONB NULL,
        "governance_model" TEXT NOT NULL DEFAULT 'individual',
        "revoked_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "asset_declaration_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_declaration_member_id" ON "asset_declaration" ("member_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_declaration_asset_kind_id" ON "asset_declaration" ("asset_kind_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_declaration_kind_slug" ON "asset_declaration" ("kind_slug") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_declaration_sensitivity_tier" ON "asset_declaration" ("sensitivity_tier") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_declaration_lifecycle" ON "asset_declaration" ("lifecycle") WHERE "deleted_at" IS NULL;`
    )

    // ── attestation ──────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "attestation" (
        "id" TEXT NOT NULL,
        "declaration_id" TEXT NOT NULL,
        "tier" TEXT NOT NULL,
        "attestor_member_id" TEXT NULL,
        "external" JSONB NULL,
        "attested_at" TIMESTAMPTZ NOT NULL,
        "expires_at" TIMESTAMPTZ NULL,
        "revoked_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "attestation_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_attestation_declaration_id" ON "attestation" ("declaration_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_attestation_tier" ON "attestation" ("tier") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_attestation_attestor_member_id" ON "attestation" ("attestor_member_id") WHERE "deleted_at" IS NULL;`
    )

    // ── project_manifest ─────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "project_manifest" (
        "id" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "version" TEXT NOT NULL,
        "display_name" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "required_asset_kinds" JSONB NOT NULL,
        "settlement_rails" JSONB NOT NULL,
        "playbook_slug" TEXT NOT NULL,
        "listing_type_slugs" JSONB NOT NULL,
        "governance_model" TEXT NOT NULL,
        "sensitivity_floor" TEXT NOT NULL,
        "surface" TEXT NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "project_manifest_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_project_manifest_slug" ON "project_manifest" ("slug") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_project_manifest_playbook_slug" ON "project_manifest" ("playbook_slug") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_project_manifest_surface" ON "project_manifest" ("surface") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_project_manifest_is_active" ON "project_manifest" ("is_active") WHERE "deleted_at" IS NULL;`
    )

    // ── project_instance ─────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "project_instance" (
        "id" TEXT NOT NULL,
        "manifest_slug" TEXT NOT NULL,
        "operator_member_id" TEXT NOT NULL,
        "member_ids" JSONB NOT NULL,
        "geography" JSONB NULL,
        "state" TEXT NOT NULL DEFAULT 'draft',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "project_instance_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_project_instance_manifest_slug" ON "project_instance" ("manifest_slug") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_project_instance_operator_member_id" ON "project_instance" ("operator_member_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_project_instance_state" ON "project_instance" ("state") WHERE "deleted_at" IS NULL;`
    )

    // ── match_proposal ───────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "match_proposal" (
        "id" TEXT NOT NULL,
        "manifest_slug" TEXT NOT NULL,
        "member_id" TEXT NOT NULL,
        "declaration_ids" JSONB NOT NULL,
        "score" REAL NOT NULL DEFAULT 0,
        "sensitivity_redacted_view" JSONB NULL,
        "state" TEXT NOT NULL DEFAULT 'pending',
        "proposed_at" TIMESTAMPTZ NOT NULL,
        "resolved_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "match_proposal_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_match_proposal_manifest_slug" ON "match_proposal" ("manifest_slug") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_match_proposal_member_id" ON "match_proposal" ("member_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_match_proposal_state" ON "match_proposal" ("state") WHERE "deleted_at" IS NULL;`
    )

    // ── settlement_record ────────────────────────────────────────
    // amount_minor is a BigNumber: both a NUMERIC scalar and a raw JSONB
    // column are needed (Medusa framework convention; see
    // hawala-ledger's AddRawColumns migration for the pattern).
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "settlement_record" (
        "id" TEXT NOT NULL,
        "manifest_slug" TEXT NOT NULL,
        "project_instance_id" TEXT NULL,
        "ledger_entry_id" TEXT NULL,
        "rail" TEXT NOT NULL,
        "from_member_id" TEXT NOT NULL,
        "to_member_id" TEXT NOT NULL,
        "amount_minor" NUMERIC(20,4) NOT NULL,
        "raw_amount_minor" JSONB NULL,
        "asset_code" TEXT NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "settlement_record_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_settlement_record_manifest_slug" ON "settlement_record" ("manifest_slug") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_settlement_record_project_instance_id" ON "settlement_record" ("project_instance_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_settlement_record_ledger_entry_id" ON "settlement_record" ("ledger_entry_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_settlement_record_rail" ON "settlement_record" ("rail") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_settlement_record_from_member_id" ON "settlement_record" ("from_member_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_settlement_record_to_member_id" ON "settlement_record" ("to_member_id") WHERE "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "settlement_record" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "match_proposal" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "project_instance" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "project_manifest" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "attestation" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "asset_declaration" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "asset_kind" CASCADE;`)
  }
}
