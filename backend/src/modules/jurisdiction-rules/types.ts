/**
 * The vocabularies of the jurisdiction-rule store, written once.
 *
 * The models' enums, the migration's CHECK constraints and the admin routes'
 * zod schemas are all built from (or pinned against) these lists;
 * `__tests__/migration.unit.spec.ts` fails when the SQL drifts from them.
 */

/** The legal programs a jurisdiction's rules are grouped under. */
export const JURISDICTION_PROGRAMS = ["home_based_food"] as const
export type JurisdictionProgram = (typeof JURISDICTION_PROGRAMS)[number]

/**
 * What a rule says.
 *
 * `not_stated` is a rule in its own right: the sources named in its citations
 * were read in full and say nothing on the topic. A reviewed `not_stated` rule
 * is the reviewer confirming the absence, not an empty slot.
 */
export const RULE_KINDS = ["requirement", "permission", "prohibition", "fact", "not_stated"] as const
export type RuleKind = (typeof RULE_KINDS)[number]

export const RULE_REVIEW_STATUSES = ["draft", "reviewed"] as const
export type RuleReviewStatus = (typeof RULE_REVIEW_STATUSES)[number]

/**
 * Coverage of one (jurisdiction, program).
 *
 * - `not_covered`: no rules on file. A state with no coverage row reads this.
 * - `draft`: rules are on file, and at least one required key has no reviewed
 *   version in force.
 * - `covered`: every required key has a reviewed version in force.
 * - `withdrawn`: rules were on file and every one of them has been withdrawn.
 */
export const COVERAGE_STATUSES = ["not_covered", "draft", "covered", "withdrawn"] as const
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number]

/** `label.statement`, `sales.online_delivery`: lowercase words joined by dots. */
export const RULE_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

/** A calendar date with no time and no zone, as the source prints it: `2026-05-01`. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** What a reader is shown when a source or rule does not give a date or document id. */
export const NOT_STATED = "not stated"

/**
 * One citation as a caller proposes it. `quote` is the source's own words,
 * verbatim; it is required for every kind except `not_stated`, where the
 * citation names a document that was read and found silent.
 */
export type RuleCitationInput = {
  source_id: string
  locator: string
  quote?: string | null
}

/**
 * The details of a source document a reader is shown beside a citation, as
 * they stood when the rule version was written.
 */
export type RuleCitationSource = {
  issuer: string
  title: string
  url: string | null
  document_id: string | null
  document_date: string | null
  document_date_note: string | null
  retrieved_at: string
  archive_ref: string
  notes: string | null
}

/** The source fields copied into every citation, in the order they are hashed (the order does not matter to the hash). */
export const RULE_CITATION_SOURCE_FIELDS = [
  "issuer",
  "title",
  "url",
  "document_id",
  "document_date",
  "document_date_note",
  "retrieved_at",
  "archive_ref",
  "notes",
] as const satisfies ReadonlyArray<keyof RuleCitationSource>

/**
 * One citation as stored. `source_sha256` and `source` are copied from the
 * source row by the service when the version is written, never taken from the
 * caller, so the rule's content hash covers the hash of the file the quote is
 * attributed to and every detail of that document a reader is shown. Readers
 * are shown these copies, not the live source row.
 */
export type RuleCitation = {
  source_id: string
  source_sha256: string
  source: RuleCitationSource
  locator: string
  quote: string | null
}

/** The fields a reviewer signs. Nothing here changes after the version is written. */
export type RuleContent = {
  jurisdiction_code: string
  program: string
  rule_key: string
  version: number
  kind: RuleKind
  value: unknown
  display_text: string
  citations: RuleCitation[]
  effective_from: string | null
  effective_note: string | null
}
