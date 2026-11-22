import { model } from "@medusajs/framework/utils"
import { RULE_KINDS, RULE_REVIEW_STATUSES } from "../types"

/**
 * jurisdiction_rule: one version of one rule. Append-only.
 *
 * A rule is identified by (`jurisdiction_code`, `program`, `rule_key`); each
 * change to its wording is a new row with the next `version`. The content
 * columns (everything down to `content_sha256`) are written once and never
 * updated: the service has no method that does, and the migration installs a
 * trigger that refuses it. What does change on a row is its place in the
 * history: a draft becomes reviewed, a version is superseded by a later one,
 * a version is withdrawn.
 *
 * Three partial unique indexes carry the invariants, so they hold whatever
 * path writes the row:
 *
 * - one row per (code, program, key, version);
 * - at most one reviewed version in force per key;
 * - at most one pending draft per key.
 *
 * A reviewed version stays in force while a correction to it is pending as a
 * draft; it is superseded only when that draft is itself reviewed.
 *
 * `proposed_by_user_id`, `reviewed_by_user_id` and `withdrawn_by_user_id` are
 * admin user ids, taken from the authenticated request and never from a body.
 * They are not customer references
 * (`src/lib/__tests__/customer-data-registry.unit.spec.ts`, NOT_A_CUSTOMER_ID).
 *
 * On a database built from the migration, triggers hold the history too: a
 * row is inserted only as a draft with no review, supersession, withdrawal or
 * deletion; no row is ever deleted or soft-deleted; and a supersession, a
 * withdrawal and a review record cannot be changed once written (see the
 * migration). The model cannot express triggers, so a schema built from it
 * (the module test runner's) has none.
 *
 * `effective_from` is a calendar date as text, or null when the source states
 * none, which readers are shown as "not stated" (see jurisdiction-source.ts
 * for why it is not a timestamp).
 */
const JurisdictionRule = model
  .define("jurisdiction_rule", {
    id: model.id({ prefix: "jrule" }).primaryKey(),

    // ---- Content: written once, covered by content_sha256 ----
    /** ISO 3166-2, e.g. `US-SC`. */
    jurisdiction_code: model.text(),
    program: model.text(),
    rule_key: model.text(),
    version: model.number(),
    kind: model.enum([...RULE_KINDS]),
    /** Structured form of the rule for code to read; the wording is `display_text`. */
    value: model.json().nullable(),
    display_text: model.text(),
    /** A JSON list of `{ source_id, source_sha256, locator, quote }`, never empty. */
    citations: model.json(),
    effective_from: model.text().nullable(),
    effective_note: model.text().nullable(),
    /** SHA-256 of the canonical content (`content-hash.ts`): what a reviewer signs. */
    content_sha256: model.text(),
    /**
     * The admin user who proposed this version, from the authenticated request.
     * Null only for a version the seed script wrote. Written once.
     */
    proposed_by_user_id: model.text().nullable(),

    // ---- Review ----
    review_status: model.enum([...RULE_REVIEW_STATUSES]).default("draft"),
    reviewed_by_user_id: model.text().nullable(),
    reviewer_name: model.text().nullable(),
    /** The reviewer's admin email at the time of the sign-off, for the record. */
    reviewer_email: model.text().nullable(),
    reviewed_at: model.dateTime().nullable(),
    review_note: model.text().nullable(),

    // ---- History ----
    superseded_by_rule_id: model.text().nullable(),
    superseded_at: model.dateTime().nullable(),
    withdrawn_at: model.dateTime().nullable(),
    withdrawn_by_user_id: model.text().nullable(),
    withdrawn_reason: model.text().nullable(),
  })
  .indexes([
    {
      on: ["jurisdiction_code", "program", "rule_key", "version"],
      unique: true,
      name: "IDX_jurisdiction_rule_key_version_unique",
    },
    {
      on: ["jurisdiction_code", "program", "rule_key"],
      unique: true,
      name: "IDX_jurisdiction_rule_one_reviewed_in_force",
      where: "review_status = 'reviewed' AND superseded_at IS NULL AND withdrawn_at IS NULL AND deleted_at IS NULL",
    },
    {
      on: ["jurisdiction_code", "program", "rule_key"],
      unique: true,
      name: "IDX_jurisdiction_rule_one_pending_draft",
      where: "review_status = 'draft' AND superseded_at IS NULL AND withdrawn_at IS NULL AND deleted_at IS NULL",
    },
    { on: ["jurisdiction_code", "program"], name: "IDX_jurisdiction_rule_code_program" },
  ])
  .checks([
    { name: "jurisdiction_rule_version_check", expression: `version >= 1` },
    { name: "jurisdiction_rule_content_sha256_check", expression: `content_sha256 ~ '^[0-9a-f]{64}$'` },
    {
      // "At least one, checked on write", at the last place a write can be
      // refused. CASE, not AND: Postgres may evaluate both sides of an AND,
      // and jsonb_array_length raises on a value that is not an array.
      name: "jurisdiction_rule_citations_present_check",
      expression: `CASE WHEN jsonb_typeof(citations) = 'array' THEN jsonb_array_length(citations) >= 1 ELSE false END`,
    },
    {
      name: "jurisdiction_rule_effective_from_check",
      expression: `effective_from IS NULL OR effective_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    },
    {
      // A reviewed row names who reviewed it and when; a draft names nobody.
      name: "jurisdiction_rule_review_record_check",
      expression: `(review_status = 'reviewed') = (reviewed_by_user_id IS NOT NULL AND reviewer_email IS NOT NULL AND reviewed_at IS NOT NULL)`,
    },
    {
      name: "jurisdiction_rule_draft_has_no_reviewer_check",
      expression: `review_status = 'reviewed' OR (reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND reviewer_name IS NULL AND reviewer_email IS NULL AND review_note IS NULL)`,
    },
    {
      name: "jurisdiction_rule_superseded_record_check",
      expression: `(superseded_at IS NULL) = (superseded_by_rule_id IS NULL)`,
    },
    {
      name: "jurisdiction_rule_withdrawn_record_check",
      expression: `(withdrawn_at IS NULL) = (withdrawn_by_user_id IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_reason IS NULL)`,
    },
  ])

export default JurisdictionRule
