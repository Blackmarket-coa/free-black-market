/**
 * The database's own guards for the jurisdiction-rule store: trigger
 * functions and triggers, installed by
 * `migrations/Migration20261118CreateJurisdictionRules.ts`.
 *
 * Kept out of the migration file on purpose. MikroORM loads a migration file
 * by taking its first export as the migration class, so an exported constant
 * in that file breaks the migration ("MigrationClass is not a constructor");
 * and every file under `migrations/` is read as a migration.
 */
const REFUSE = `USING ERRCODE = 'restrict_violation'`

/**
 * A rule version is born a draft. Its review, supersession and withdrawal are
 * recorded later, by UPDATEs the guard below allows once each, so a row
 * cannot arrive already reviewed (or already withdrawn, or soft-deleted).
 */
const RULE_GUARD_INSERT = `CREATE OR REPLACE FUNCTION jurisdiction_rule_guard_insert() RETURNS trigger AS $body$
BEGIN
  IF NEW.review_status IS DISTINCT FROM 'draft'
     OR NEW.reviewed_by_user_id IS NOT NULL OR NEW.reviewer_name IS NOT NULL OR NEW.reviewer_email IS NOT NULL
     OR NEW.reviewed_at IS NOT NULL OR NEW.review_note IS NOT NULL
     OR NEW.superseded_by_rule_id IS NOT NULL OR NEW.superseded_at IS NOT NULL
     OR NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by_user_id IS NOT NULL OR NEW.withdrawn_reason IS NOT NULL
     OR NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'jurisdiction_rule % must be written as a draft with no review, supersession, withdrawal or deletion', NEW.id
      ${REFUSE};
  END IF;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;`

/**
 * What an UPDATE of a rule version may change: a draft may become reviewed
 * (once), a version in force may be superseded (once) or withdrawn (once).
 * Nothing else. The content and its hash, the row's identity and proposer,
 * a review record once written, a supersession once written, a withdrawal
 * once written, and `deleted_at` (rows are never soft-deleted) are frozen.
 */
const RULE_GUARD_UPDATE = `CREATE OR REPLACE FUNCTION jurisdiction_rule_guard_update() RETURNS trigger AS $body$
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
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.proposed_by_user_id IS DISTINCT FROM OLD.proposed_by_user_id THEN
    RAISE EXCEPTION 'jurisdiction_rule % is append-only: its content cannot be changed, write a new version', OLD.id
      ${REFUSE};
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'jurisdiction_rule % is never deleted or restored: withdraw it instead', OLD.id
      ${REFUSE};
  END IF;
  IF OLD.review_status = 'reviewed' AND (
       NEW.review_status IS DISTINCT FROM OLD.review_status
       OR NEW.reviewed_by_user_id IS DISTINCT FROM OLD.reviewed_by_user_id
       OR NEW.reviewer_name IS DISTINCT FROM OLD.reviewer_name
       OR NEW.reviewer_email IS DISTINCT FROM OLD.reviewer_email
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.review_note IS DISTINCT FROM OLD.review_note) THEN
    RAISE EXCEPTION 'jurisdiction_rule % is reviewed: its review record cannot be changed', OLD.id
      ${REFUSE};
  END IF;
  IF OLD.superseded_at IS NOT NULL AND (
       NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
       OR NEW.superseded_by_rule_id IS DISTINCT FROM OLD.superseded_by_rule_id) THEN
    RAISE EXCEPTION 'jurisdiction_rule % was superseded: its supersession cannot be changed', OLD.id
      ${REFUSE};
  END IF;
  IF OLD.withdrawn_at IS NOT NULL AND (
       NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
       OR NEW.withdrawn_by_user_id IS DISTINCT FROM OLD.withdrawn_by_user_id
       OR NEW.withdrawn_reason IS DISTINCT FROM OLD.withdrawn_reason) THEN
    RAISE EXCEPTION 'jurisdiction_rule % was withdrawn: its withdrawal cannot be changed', OLD.id
      ${REFUSE};
  END IF;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;`

/** A source is an archived file and its hash: written once by the seed, never changed. */
const SOURCE_GUARD_UPDATE = `CREATE OR REPLACE FUNCTION jurisdiction_source_refuse_update() RETURNS trigger AS $body$
BEGIN
  RAISE EXCEPTION 'jurisdiction_source % is immutable: archive the new document and record it as a new source', OLD.id
    ${REFUSE};
END;
$body$ LANGUAGE plpgsql;`

/**
 * Coverage's required keys only grow, so what "covered" takes cannot be
 * loosened; its identity and `deleted_at` are frozen, so it cannot be
 * soft-deleted and opened again with fewer keys. Its stored status may move:
 * it is a record, and readers are told a status computed from the rules.
 */
const COVERAGE_GUARD_UPDATE = `CREATE OR REPLACE FUNCTION jurisdiction_coverage_guard_update() RETURNS trigger AS $body$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.jurisdiction_code IS DISTINCT FROM OLD.jurisdiction_code
     OR NEW.program IS DISTINCT FROM OLD.program
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'jurisdiction_coverage % cannot be re-pointed, deleted or restored', OLD.id
      ${REFUSE};
  END IF;
  IF NOT (NEW.required_rule_keys @> OLD.required_rule_keys) THEN
    RAISE EXCEPTION 'jurisdiction_coverage % required_rule_keys only grows: a required key cannot be removed', OLD.id
      ${REFUSE};
  END IF;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;`

/** No row of the store is ever deleted: a rule is withdrawn, a source and a coverage row stay. */
const REFUSE_DELETE = `CREATE OR REPLACE FUNCTION jurisdiction_store_refuse_delete() RETURNS trigger AS $body$
BEGIN
  RAISE EXCEPTION '% rows are never deleted (%)', TG_TABLE_NAME, OLD.id
    ${REFUSE};
END;
$body$ LANGUAGE plpgsql;`

/** [table, trigger, timing and event, function], in the order they are created. */
export const GUARD_TRIGGER_DEFINITIONS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["jurisdiction_rule", "jurisdiction_rule_guard_insert", "BEFORE INSERT", "jurisdiction_rule_guard_insert"],
  ["jurisdiction_rule", "jurisdiction_rule_guard_update", "BEFORE UPDATE", "jurisdiction_rule_guard_update"],
  ["jurisdiction_rule", "jurisdiction_rule_refuse_delete", "BEFORE DELETE", "jurisdiction_store_refuse_delete"],
  ["jurisdiction_source", "jurisdiction_source_refuse_update", "BEFORE UPDATE", "jurisdiction_source_refuse_update"],
  ["jurisdiction_source", "jurisdiction_source_refuse_delete", "BEFORE DELETE", "jurisdiction_store_refuse_delete"],
  ["jurisdiction_coverage", "jurisdiction_coverage_guard_update", "BEFORE UPDATE", "jurisdiction_coverage_guard_update"],
  ["jurisdiction_coverage", "jurisdiction_coverage_refuse_delete", "BEFORE DELETE", "jurisdiction_store_refuse_delete"],
]

export const GUARD_TRIGGERS = GUARD_TRIGGER_DEFINITIONS.map(([table, trigger]) => [table, trigger] as const)

export const GUARD_FUNCTIONS = [
  "jurisdiction_rule_guard_insert",
  "jurisdiction_rule_guard_update",
  "jurisdiction_source_refuse_update",
  "jurisdiction_coverage_guard_update",
  "jurisdiction_store_refuse_delete",
] as const

export const JURISDICTION_RULE_GUARDS: string[] = [
  RULE_GUARD_INSERT,
  RULE_GUARD_UPDATE,
  SOURCE_GUARD_UPDATE,
  COVERAGE_GUARD_UPDATE,
  REFUSE_DELETE,
  ...GUARD_TRIGGER_DEFINITIONS.flatMap(([table, trigger, when, fn]) => [
    `DROP TRIGGER IF EXISTS "${trigger}" ON "${table}";`,
    `CREATE TRIGGER "${trigger}" ${when} ON "${table}" FOR EACH ROW EXECUTE PROCEDURE ${fn}();`,
  ]),
]
