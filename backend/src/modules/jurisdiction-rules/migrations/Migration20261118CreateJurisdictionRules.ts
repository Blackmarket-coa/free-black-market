import { Migration } from "@medusajs/framework/mikro-orm/migrations"

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
 * One thing here has no counterpart in the models: the trigger at the end.
 * The models cannot express it, so a schema built from them (the module test
 * runner's) does not have it; the service's own refusals are what that runner
 * tests. On a migrated database the trigger is the last line: a version's
 * content, and a reviewed version's review record, cannot be changed by any
 * UPDATE, whoever issues it.
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
      `create table if not exists "jurisdiction_rule" ("id" text not null, "jurisdiction_code" text not null, "program" text not null, "rule_key" text not null, "version" integer not null, "kind" text check ("kind" in ('requirement', 'permission', 'prohibition', 'fact', 'not_stated')) not null, "value" jsonb null, "display_text" text not null, "citations" jsonb not null, "effective_from" text null, "effective_note" text null, "content_sha256" text not null, "review_status" text check ("review_status" in ('draft', 'reviewed')) not null default 'draft', "reviewed_by_user_id" text null, "reviewer_name" text null, "reviewed_at" timestamptz null, "review_note" text null, "superseded_by_rule_id" text null, "superseded_at" timestamptz null, "withdrawn_at" timestamptz null, "withdrawn_by_user_id" text null, "withdrawn_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "jurisdiction_rule_pkey" primary key ("id"), constraint jurisdiction_rule_version_check check (version >= 1), constraint jurisdiction_rule_content_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$'), constraint jurisdiction_rule_citations_present_check check (CASE WHEN jsonb_typeof(citations) = 'array' THEN jsonb_array_length(citations) >= 1 ELSE false END), constraint jurisdiction_rule_effective_from_check check (effective_from IS NULL OR effective_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), constraint jurisdiction_rule_review_record_check check ((review_status = 'reviewed') = (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)), constraint jurisdiction_rule_draft_has_no_reviewer_check check (review_status = 'reviewed' OR (reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND reviewer_name IS NULL AND review_note IS NULL)), constraint jurisdiction_rule_superseded_record_check check ((superseded_at IS NULL) = (superseded_by_rule_id IS NULL)), constraint jurisdiction_rule_withdrawn_record_check check ((withdrawn_at IS NULL) = (withdrawn_by_user_id IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_reason IS NULL)));`
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

    // Append-only content, at the database. `IS DISTINCT FROM` so a NULL
    // becoming a value (or the reverse) counts as a change. The review record
    // of a row that is already reviewed is frozen the same way; a draft's is
    // not, because becoming reviewed is the one change a draft is for.
    // `EXECUTE PROCEDURE` rather than `EXECUTE FUNCTION`: both mean the same
    // from Postgres 11 on, and only the former exists before it.
    this.addSql(
      `CREATE OR REPLACE FUNCTION jurisdiction_rule_refuse_content_change() RETURNS trigger AS $body$
BEGIN
  IF NEW.jurisdiction_code IS DISTINCT FROM OLD.jurisdiction_code
     OR NEW.program IS DISTINCT FROM OLD.program
     OR NEW.rule_key IS DISTINCT FROM OLD.rule_key
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.display_text IS DISTINCT FROM OLD.display_text
     OR NEW.citations IS DISTINCT FROM OLD.citations
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.effective_note IS DISTINCT FROM OLD.effective_note
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 THEN
    RAISE EXCEPTION 'jurisdiction_rule % is append-only: its content cannot be changed, write a new version', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.review_status = 'reviewed' AND (
       NEW.review_status IS DISTINCT FROM OLD.review_status
       OR NEW.reviewed_by_user_id IS DISTINCT FROM OLD.reviewed_by_user_id
       OR NEW.reviewer_name IS DISTINCT FROM OLD.reviewer_name
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.review_note IS DISTINCT FROM OLD.review_note) THEN
    RAISE EXCEPTION 'jurisdiction_rule % is reviewed: its review record cannot be changed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;`
    )
    this.addSql(`DROP TRIGGER IF EXISTS "jurisdiction_rule_refuse_content_change" ON "jurisdiction_rule";`)
    this.addSql(
      `CREATE TRIGGER "jurisdiction_rule_refuse_content_change" BEFORE UPDATE ON "jurisdiction_rule" FOR EACH ROW EXECUTE PROCEDURE jurisdiction_rule_refuse_content_change();`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TRIGGER IF EXISTS "jurisdiction_rule_refuse_content_change" ON "jurisdiction_rule";`)
    this.addSql(`DROP FUNCTION IF EXISTS jurisdiction_rule_refuse_content_change();`)
    this.addSql(`drop table if exists "jurisdiction_coverage" cascade;`)
    this.addSql(`drop table if exists "jurisdiction_rule" cascade;`)
    this.addSql(`drop table if exists "jurisdiction_source" cascade;`)
  }
}
