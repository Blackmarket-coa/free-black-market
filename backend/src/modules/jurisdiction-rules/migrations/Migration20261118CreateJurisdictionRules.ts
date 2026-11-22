import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { GUARD_FUNCTIONS, GUARD_TRIGGERS, JURISDICTION_RULE_GUARDS } from "../db-guards"

/**
 * jurisdiction_source, jurisdiction_rule, jurisdiction_coverage: the Plates
 * pilot's jurisdiction-rule store (docs/PLATES_SC_PILOT_PLAN.md, Phase 2).
 *
 * The tables, columns, CHECK constraints and indexes below are the statements
 * MikroORM derives from the three models (generated 2026-11-21 and copied
 * here, with `if not exists` added), so a database built from this migration
 * and a schema built from the models are the same shape. That matters twice:
 * the HTTP integration runner builds from migrations and the module runner
 * from models, and `integration-tests/http/module-schema-drift.spec.ts` fails
 * on a model column no migration created. `__tests__/migration.unit.spec.ts`
 * pins the vocabularies and the column list against the models.
 *
 * Vocabularies are TEXT + CHECK, which is what MikroORM renders for
 * `model.enum`, not native enum types: a later change is a DROP / ADD
 * CONSTRAINT inside the migration's transaction on any Postgres version.
 *
 * One thing here has no counterpart in the models: the guard triggers at the
 * end. The models cannot express them, so a schema built from the models (the
 * module test runner's) has none, and that runner tests the service's own
 * refusals; the triggers are pinned on a migrated database by
 * `integration-tests/http/jurisdiction-rules-signoff.spec.ts`. On a migrated
 * database they hold whoever writes:
 *
 * - jurisdiction_rule: inserted only as a draft with no review,
 *   supersession, withdrawal or deletion; never deleted or soft-deleted; its
 *   content, identity and proposer never change; a review record, a
 *   supersession and a withdrawal, once written, never change.
 * - jurisdiction_source: never updated or deleted.
 * - jurisdiction_coverage: never deleted, re-pointed or soft-deleted, and its
 *   required keys only grow.
 *
 * What they do not stop: someone with direct write access can still issue the
 * same statements the service issues (insert a draft, mark it reviewed), and
 * can compute the content hash, which is public. They keep the history from
 * being rewritten or a reviewed row from being forged in one stroke; they are
 * not an authorisation layer.
 */
export class Migration20261118CreateJurisdictionRules extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "jurisdiction_source" ("id" text not null, "jurisdiction_code" text not null, "issuer" text not null, "title" text not null, "url" text null, "document_id" text null, "document_date" text null, "document_date_note" text null, "retrieved_at" text not null, "content_sha256" text not null, "archive_ref" text not null, "notes" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "jurisdiction_source_pkey" primary key ("id"), constraint jurisdiction_source_content_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$'), constraint jurisdiction_source_document_date_check check (document_date IS NULL OR document_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), constraint jurisdiction_source_retrieved_at_check check (retrieved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_jurisdiction_source_deleted_at" ON "jurisdiction_source" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_source_code_sha256_unique" ON "jurisdiction_source" ("jurisdiction_code", "content_sha256") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_jurisdiction_source_jurisdiction_code" ON "jurisdiction_source" ("jurisdiction_code") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "jurisdiction_rule" ("id" text not null, "jurisdiction_code" text not null, "program" text not null, "rule_key" text not null, "version" integer not null, "kind" text check ("kind" in ('requirement', 'permission', 'prohibition', 'fact', 'not_stated')) not null, "value" jsonb null, "display_text" text not null, "citations" jsonb not null, "effective_from" text null, "effective_note" text null, "content_sha256" text not null, "proposed_by_user_id" text null, "review_status" text check ("review_status" in ('draft', 'reviewed')) not null default 'draft', "reviewed_by_user_id" text null, "reviewer_name" text null, "reviewer_email" text null, "reviewed_at" timestamptz null, "review_note" text null, "superseded_by_rule_id" text null, "superseded_at" timestamptz null, "withdrawn_at" timestamptz null, "withdrawn_by_user_id" text null, "withdrawn_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "jurisdiction_rule_pkey" primary key ("id"), constraint jurisdiction_rule_version_check check (version >= 1), constraint jurisdiction_rule_content_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$'), constraint jurisdiction_rule_citations_present_check check (CASE WHEN jsonb_typeof(citations) = 'array' THEN jsonb_array_length(citations) >= 1 ELSE false END), constraint jurisdiction_rule_effective_from_check check (effective_from IS NULL OR effective_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), constraint jurisdiction_rule_review_record_check check ((review_status = 'reviewed') = (reviewed_by_user_id IS NOT NULL AND reviewer_email IS NOT NULL AND reviewed_at IS NOT NULL)), constraint jurisdiction_rule_draft_has_no_reviewer_check check (review_status = 'reviewed' OR (reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND reviewer_name IS NULL AND reviewer_email IS NULL AND review_note IS NULL)), constraint jurisdiction_rule_superseded_record_check check ((superseded_at IS NULL) = (superseded_by_rule_id IS NULL)), constraint jurisdiction_rule_withdrawn_record_check check ((withdrawn_at IS NULL) = (withdrawn_by_user_id IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_reason IS NULL)));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_deleted_at" ON "jurisdiction_rule" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_key_version_unique" ON "jurisdiction_rule" ("jurisdiction_code", "program", "rule_key", "version") WHERE deleted_at IS NULL;`
    )
    // At most one reviewed version in force per key.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_one_reviewed_in_force" ON "jurisdiction_rule" ("jurisdiction_code", "program", "rule_key") WHERE review_status = 'reviewed' AND superseded_at IS NULL AND withdrawn_at IS NULL AND deleted_at IS NULL;`
    )
    // At most one pending draft per key.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_one_pending_draft" ON "jurisdiction_rule" ("jurisdiction_code", "program", "rule_key") WHERE review_status = 'draft' AND superseded_at IS NULL AND withdrawn_at IS NULL AND deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_code_program" ON "jurisdiction_rule" ("jurisdiction_code", "program") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "jurisdiction_coverage" ("id" text not null, "jurisdiction_code" text not null, "program" text not null, "status" text check ("status" in ('not_covered', 'draft', 'covered', 'withdrawn')) not null default 'not_covered', "required_rule_keys" jsonb not null, "status_changed_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "jurisdiction_coverage_pkey" primary key ("id"), constraint jurisdiction_coverage_required_rule_keys_check check (jsonb_typeof(required_rule_keys) = 'array'));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_jurisdiction_coverage_deleted_at" ON "jurisdiction_coverage" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_coverage_code_program_unique" ON "jurisdiction_coverage" ("jurisdiction_code", "program") WHERE deleted_at IS NULL;`
    )

    // The database's own guards. Each refuses with ERRCODE restrict_violation
    // and a message naming what it protects. `IS DISTINCT FROM` so a NULL
    // becoming a value (or the reverse) counts as a change. `EXECUTE
    // PROCEDURE` rather than `EXECUTE FUNCTION`: both mean the same from
    // Postgres 11 on, and only the former exists before it. TRUNCATE is not
    // guarded: it is what the test runners use to reset a database.
    for (const sql of JURISDICTION_RULE_GUARDS) this.addSql(sql)
  }

  override async down(): Promise<void> {
    for (const [table, trigger] of GUARD_TRIGGERS) this.addSql(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}";`)
    for (const fn of GUARD_FUNCTIONS) this.addSql(`DROP FUNCTION IF EXISTS ${fn}();`)
    this.addSql(`drop table if exists "jurisdiction_coverage" cascade;`)
    this.addSql(`drop table if exists "jurisdiction_rule" cascade;`)
    this.addSql(`drop table if exists "jurisdiction_source" cascade;`)
  }
}
