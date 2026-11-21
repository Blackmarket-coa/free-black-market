import type { Context } from "@medusajs/framework/types"
import {
  InjectTransactionManager,
  MedusaContext,
  MedusaService,
  generateEntityId,
} from "@medusajs/framework/utils"
import { JurisdictionCoverage, JurisdictionRule, JurisdictionSource } from "./models"
import { ruleContentOf, ruleContentSha256 } from "./content-hash"
import { coverageStatusOf, inForce, requiredKeysNotReviewed, type RuleVersionState } from "./coverage"
import { isIsoDate, ruleDraftProblems, type RuleDraftInput } from "./rule-draft"
import {
  JURISDICTION_PROGRAMS,
  SHA256_PATTERN,
  type CoverageStatus,
  type RuleCitation,
  type RuleContent,
  type RuleReviewStatus,
} from "./types"
import { US_JURISDICTIONS, isUsJurisdictionCode, usJurisdictionName } from "./us-jurisdictions"

/**
 * Why a call was refused. Routes map these onto HTTP; nothing else should
 * need to read the message.
 *
 * - `invalid`: the input cannot be a rule or a source (400).
 * - `not_found`: no such rule version (404).
 * - `not_opened`: the jurisdiction has no coverage row; a seed opens one (409).
 * - `stale`: the version is not the pending draft with the hash the reviewer
 *   was shown (409). Nothing was written.
 * - `conflict`: the version is not in a state the action applies to, or
 *   another write got there first (409).
 * - `integrity`: the stored content no longer matches its stored hash (409).
 *   Nothing was written; someone needs to look at the row.
 * - `closed`: a generated write method this module does not allow.
 */
export type JurisdictionRuleErrorReason =
  | "invalid"
  | "not_found"
  | "not_opened"
  | "stale"
  | "conflict"
  | "integrity"
  | "closed"

export class JurisdictionRuleError extends Error {
  readonly reason: JurisdictionRuleErrorReason
  readonly details: string[]

  constructor(reason: JurisdictionRuleErrorReason, message: string, details: string[] = []) {
    super(message)
    this.name = "JurisdictionRuleError"
    this.reason = reason
    this.details = details
  }
}

type Timestamp = Date | string

export type JurisdictionSourceRecord = {
  id: string
  jurisdiction_code: string
  issuer: string
  title: string
  url: string | null
  document_id: string | null
  document_date: string | null
  document_date_note: string | null
  retrieved_at: string
  content_sha256: string
  archive_ref: string
  notes: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export type JurisdictionRuleRecord = RuleContent & {
  id: string
  content_sha256: string
  review_status: RuleReviewStatus
  reviewed_by_user_id: string | null
  reviewer_name: string | null
  reviewed_at: Timestamp | null
  review_note: string | null
  superseded_by_rule_id: string | null
  superseded_at: Timestamp | null
  withdrawn_at: Timestamp | null
  withdrawn_by_user_id: string | null
  withdrawn_reason: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export type JurisdictionCoverageRecord = {
  id: string
  jurisdiction_code: string
  program: string
  status: CoverageStatus
  required_rule_keys: string[]
  status_changed_at: Timestamp
}

/** Where one version stands in its key's history. */
export type RuleVersionStanding = "pending_draft" | "reviewed_in_force" | "superseded" | "withdrawn"

export function standingOf(rule: RuleVersionState): RuleVersionStanding {
  if (rule.withdrawn_at != null) return "withdrawn"
  if (rule.superseded_at != null) return "superseded"
  return rule.review_status === "reviewed" ? "reviewed_in_force" : "pending_draft"
}

export type RegisterSourceInput = {
  jurisdiction_code: string
  issuer: string
  title: string
  url?: string | null
  document_id?: string | null
  document_date?: string | null
  document_date_note?: string | null
  retrieved_at: string
  content_sha256: string
  archive_ref: string
  notes?: string | null
}

export type CreateDraftVersionOptions = {
  /**
   * Write version 1 only when the key has no version at all, and otherwise
   * write nothing. The seed's mode: it must never add a version to a key that
   * already has history, reviewed or not.
   */
  onlyIfKeyHasNoVersion?: boolean
}

export type CreateDraftVersionResult =
  | { created: true; rule: JurisdictionRuleRecord; superseded_draft_id: string | null; coverage: JurisdictionCoverageRecord }
  | { created: false; rule: null }

export type MarkReviewedInput = {
  rule_id: string
  /** The hash of the text the reviewer was shown. */
  expected_content_sha256: string
  /** The authenticated admin. The caller reads this from the session, never from a request body. */
  reviewer: { user_id: string; name: string | null }
  note?: string | null
}

export type MarkReviewedResult = {
  rule: JurisdictionRuleRecord
  /** The reviewed version this one replaced, if there was one. */
  superseded_rule_id: string | null
  coverage: JurisdictionCoverageRecord
}

export type WithdrawRuleInput = {
  rule_id: string
  /** The authenticated admin, read from the session. */
  withdrawn_by_user_id: string
  reason: string
}

export type RuleViewSource = Pick<
  JurisdictionSourceRecord,
  | "id"
  | "issuer"
  | "title"
  | "url"
  | "document_id"
  | "document_date"
  | "document_date_note"
  | "retrieved_at"
  | "content_sha256"
  | "archive_ref"
>

export type RuleViewEntry = {
  id: string
  rule_key: string
  version: number
  kind: RuleContent["kind"]
  value: unknown
  display_text: string
  citations: Array<{ locator: string; quote: string | null; source: RuleViewSource | null }>
  effective_from: string | null
  effective_note: string | null
  review_status: RuleReviewStatus
  reviewed_at: Timestamp | null
  reviewer_name: string | null
  content_sha256: string
  /** A reviewed version is in force and a draft correcting it is waiting for review. */
  correction_pending: boolean
}

export type RuleView = {
  jurisdiction_code: string
  jurisdiction_name: string | null
  program: string
  coverage: {
    status: CoverageStatus
    required_rule_keys: string[]
    required_keys_not_reviewed: string[]
    status_changed_at: Timestamp | null
  }
  rules: RuleViewEntry[]
}

type SqlManager = {
  execute(sql: string, params: unknown[], method: "all"): Promise<Record<string, unknown>[]>
}

const managerOf = (sharedContext: Context): SqlManager => sharedContext.transactionManager as unknown as SqlManager

const filled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

/** Postgres's unique_violation, as the driver or MikroORM's wrapper reports it. */
const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === "23505"

const closed = (method: string, instead: string) =>
  async (..._args: unknown[]): Promise<never> => {
    throw new JurisdictionRuleError("closed", `${method} is not available on the jurisdiction-rule store: ${instead}`)
  }

const RULE_WRITES = "rule versions are written by createDraftVersion, markReviewed and withdrawRule only"
const SOURCE_WRITES = "sources are written by registerSource only, from an archived file"
const COVERAGE_WRITES = "coverage is written by openCoverage and recomputed with every rule change"

/** Every reason these fields cannot be a source row. Empty means they can. */
export function sourceProblems(input: RegisterSourceInput): string[] {
  const problems: string[] = []
  if (!isUsJurisdictionCode(input.jurisdiction_code)) {
    problems.push("jurisdiction_code must be an ISO 3166-2 code for a US state or DC, such as US-SC")
  }
  if (!filled(input.issuer)) problems.push("issuer is required")
  if (!filled(input.title)) problems.push("title is required")
  if (!filled(input.archive_ref)) problems.push("archive_ref is required: the repository path of the archived file")
  if (typeof input.content_sha256 !== "string" || !SHA256_PATTERN.test(input.content_sha256)) {
    problems.push("content_sha256 must be the archived file's SHA-256 as 64 lowercase hex characters")
  }
  if (!isIsoDate(input.retrieved_at)) problems.push("retrieved_at must be a calendar date as YYYY-MM-DD")
  if (input.document_date != null && !isIsoDate(input.document_date)) {
    problems.push("document_date must be a calendar date as YYYY-MM-DD, or left out when the document prints none")
  }
  if (input.url != null && !/^https:\/\/\S+$/.test(input.url)) problems.push("url must be an https address, or left out")
  return problems
}

function toRuleRecord(row: Record<string, unknown>): JurisdictionRuleRecord {
  const rule = row as unknown as JurisdictionRuleRecord
  return {
    ...rule,
    version: Number(rule.version),
    value: rule.value ?? null,
    citations: (Array.isArray(rule.citations) ? rule.citations : []) as RuleCitation[],
  }
}

function toCoverageRecord(row: Record<string, unknown>): JurisdictionCoverageRecord {
  const coverage = row as unknown as JurisdictionCoverageRecord
  return {
    id: coverage.id,
    jurisdiction_code: coverage.jurisdiction_code,
    program: coverage.program,
    status: coverage.status,
    required_rule_keys: Array.isArray(coverage.required_rule_keys) ? coverage.required_rule_keys : [],
    status_changed_at: coverage.status_changed_at,
  }
}

/** Why the sign-off's one UPDATE matched nothing, said from the row as it was read just before. */
function staleReason(rule: JurisdictionRuleRecord, expectedSha256: string): string {
  if (rule.withdrawn_at != null) return "this version was withdrawn"
  if (rule.superseded_at != null) return "this version was replaced by a later one"
  if (rule.review_status === "reviewed") return "this version is already reviewed"
  if (rule.content_sha256 !== expectedSha256) {
    return "the content hash sent does not match this version: the text on file is not the text that was shown"
  }
  return "this version changed while it was being reviewed"
}

/**
 * Jurisdiction-rule store.
 *
 * Holds what FBM's sources say about selling food made at home in a given
 * state, one rule per row, each with the source's own words beside the
 * wording FBM shows, and a record of who reviewed that wording against the
 * source and when.
 *
 * **Rules are information.** Nothing here is a verdict about a seller or a
 * product, no method answers "may this be sold", and the module is imported
 * by nothing on the cart or checkout path (`__tests__/information-only.unit.spec.ts`).
 *
 * The guards sit in this service, and under it in the database, for the
 * reason `hawala-ledger/posture-a-guard.ts` gives: a route or a hook can be
 * bypassed, and this is the only layer every write passes through.
 *
 * - A version's content is written once. The generated `create*`, `update*`,
 *   `delete*`, `softDelete*` and `restore*` methods are closed for all three
 *   tables; the three methods below are the only writers of a rule.
 * - A sign-off is one conditional UPDATE naming the version and the hash of
 *   the text the reviewer was shown. It writes only if that version is still
 *   the pending draft and still carries that hash.
 * - `covered` is computed (`coverage.ts`), in the same transaction as the
 *   change it follows, and never set.
 *
 * Every write for one (jurisdiction, program) takes a row lock on its
 * coverage row first, so version numbering and supersession are serial within
 * a jurisdiction. The conditional UPDATEs do not rely on that lock; they
 * would refuse a stale write without it.
 */
class JurisdictionRulesModuleService extends MedusaService({
  JurisdictionSource,
  JurisdictionRule,
  JurisdictionCoverage,
}) {
  // The generated writers, closed. Instance properties, so they shadow the
  // methods MedusaService puts on the prototype; the generated list and
  // retrieve methods are left as they are.
  readonly createJurisdictionRules = closed("createJurisdictionRules", RULE_WRITES)
  readonly updateJurisdictionRules = closed("updateJurisdictionRules", RULE_WRITES)
  readonly deleteJurisdictionRules = closed("deleteJurisdictionRules", RULE_WRITES)
  readonly softDeleteJurisdictionRules = closed("softDeleteJurisdictionRules", RULE_WRITES)
  readonly restoreJurisdictionRules = closed("restoreJurisdictionRules", RULE_WRITES)
  readonly createJurisdictionSources = closed("createJurisdictionSources", SOURCE_WRITES)
  readonly updateJurisdictionSources = closed("updateJurisdictionSources", SOURCE_WRITES)
  readonly deleteJurisdictionSources = closed("deleteJurisdictionSources", SOURCE_WRITES)
  readonly softDeleteJurisdictionSources = closed("softDeleteJurisdictionSources", SOURCE_WRITES)
  readonly restoreJurisdictionSources = closed("restoreJurisdictionSources", SOURCE_WRITES)
  readonly createJurisdictionCoverages = closed("createJurisdictionCoverages", COVERAGE_WRITES)
  readonly updateJurisdictionCoverages = closed("updateJurisdictionCoverages", COVERAGE_WRITES)
  readonly deleteJurisdictionCoverages = closed("deleteJurisdictionCoverages", COVERAGE_WRITES)
  readonly softDeleteJurisdictionCoverages = closed("softDeleteJurisdictionCoverages", COVERAGE_WRITES)
  readonly restoreJurisdictionCoverages = closed("restoreJurisdictionCoverages", COVERAGE_WRITES)

  // ==================== Reads ====================

  /**
   * The rules a reader is shown for one jurisdiction and program: per key, the
   * reviewed version in force, or (only with `includeDrafts`) the pending
   * draft when no reviewed version exists. Superseded and withdrawn versions
   * are history and never appear here.
   *
   * Coverage is computed from the versions just read rather than taken from
   * the coverage row's cached `status`, so this view cannot say `covered`
   * while showing a required key as a draft.
   */
  async getRuleView(
    jurisdictionCode: string,
    program: string,
    options: { includeDrafts: boolean }
  ): Promise<RuleView> {
    const [coverageRow] = (await this.listJurisdictionCoverages({
      jurisdiction_code: jurisdictionCode,
      program,
    })) as unknown as Record<string, unknown>[]
    const coverage = coverageRow ? toCoverageRecord(coverageRow) : null
    const required = coverage?.required_rule_keys ?? []

    const versions = (
      (await this.listJurisdictionRules(
        { jurisdiction_code: jurisdictionCode, program },
        { order: { rule_key: "ASC", version: "ASC" }, take: null }
      )) as unknown as Record<string, unknown>[]
    ).map(toRuleRecord)

    const byKey = new Map<string, { reviewed?: JurisdictionRuleRecord; draft?: JurisdictionRuleRecord }>()
    for (const version of versions) {
      if (!inForce(version)) continue
      const slot = byKey.get(version.rule_key) ?? {}
      if (version.review_status === "reviewed") slot.reviewed = version
      else slot.draft = version
      byKey.set(version.rule_key, slot)
    }

    const shown: Array<{ rule: JurisdictionRuleRecord; correction_pending: boolean }> = []
    for (const slot of byKey.values()) {
      if (slot.reviewed) shown.push({ rule: slot.reviewed, correction_pending: Boolean(slot.draft) })
      else if (slot.draft && options.includeDrafts) shown.push({ rule: slot.draft, correction_pending: false })
    }
    // Required keys first, in the order coverage lists them; then any others by key.
    const rank = (key: string) => {
      const index = required.indexOf(key)
      return index === -1 ? required.length : index
    }
    shown.sort((a, b) => rank(a.rule.rule_key) - rank(b.rule.rule_key) || a.rule.rule_key.localeCompare(b.rule.rule_key))

    const sourceIds = [...new Set(shown.flatMap(({ rule }) => rule.citations.map((c) => c.source_id)))]
    const sources = sourceIds.length
      ? ((await this.listJurisdictionSources({ id: sourceIds }, { take: null })) as unknown as JurisdictionSourceRecord[])
      : []
    const sourceById = new Map(sources.map((s) => [s.id, s]))
    const sourceView = (id: string): RuleViewSource | null => {
      const s = sourceById.get(id)
      if (!s) return null
      return {
        id: s.id,
        issuer: s.issuer,
        title: s.title,
        url: s.url ?? null,
        document_id: s.document_id ?? null,
        document_date: s.document_date ?? null,
        document_date_note: s.document_date_note ?? null,
        retrieved_at: s.retrieved_at,
        content_sha256: s.content_sha256,
        archive_ref: s.archive_ref,
      }
    }

    return {
      jurisdiction_code: jurisdictionCode,
      jurisdiction_name: usJurisdictionName(jurisdictionCode),
      program,
      coverage: {
        status: coverageStatusOf(required, versions),
        required_rule_keys: required,
        required_keys_not_reviewed: requiredKeysNotReviewed(required, versions),
        status_changed_at: coverage?.status_changed_at ?? null,
      },
      rules: shown.map(({ rule, correction_pending }) => ({
        id: rule.id,
        rule_key: rule.rule_key,
        version: rule.version,
        kind: rule.kind,
        value: rule.value,
        display_text: rule.display_text,
        citations: rule.citations.map((c) => ({
          locator: c.locator,
          quote: c.quote ?? null,
          source: sourceView(c.source_id),
        })),
        effective_from: rule.effective_from ?? null,
        effective_note: rule.effective_note ?? null,
        review_status: rule.review_status,
        reviewed_at: rule.reviewed_at ?? null,
        reviewer_name: rule.reviewer_name ?? null,
        content_sha256: rule.content_sha256,
        correction_pending,
      })),
    }
  }

  /** Every version on file, history included, with where each stands. For the admin screens. */
  async listRuleVersions(
    filters: { jurisdiction_code?: string; program?: string; rule_key?: string; id?: string | string[] } = {}
  ): Promise<Array<JurisdictionRuleRecord & { standing: RuleVersionStanding }>> {
    const where: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) where[key] = value
    const rows = (await this.listJurisdictionRules(where, {
      order: { jurisdiction_code: "ASC", program: "ASC", rule_key: "ASC", version: "DESC" },
      take: null,
    })) as unknown as Record<string, unknown>[]
    return rows.map(toRuleRecord).map((rule) => ({ ...rule, standing: standingOf(rule) }))
  }

  /**
   * Every state and DC with where its coverage stands for a program. A state
   * with no coverage row is `not_covered`: that is the answer for all of them
   * until a seed opens one.
   *
   * For an opened jurisdiction the status is computed here from the rule
   * versions on file, as `getRuleView` computes it, not read from the row's
   * stored `status`. The stored value is the record of when coverage last
   * changed; what a reader is told is always worked out from the rules.
   */
  async listCoverage(program: string): Promise<
    Array<{
      jurisdiction_code: string
      jurisdiction_name: string
      program: string
      /** Whether a coverage row exists. False for every state no seed has opened. */
      opened: boolean
      status: CoverageStatus
      status_changed_at: Timestamp | null
      required_rule_keys: string[]
      required_keys_not_reviewed: string[]
    }>
  > {
    const rows = (
      (await this.listJurisdictionCoverages({ program }, { take: null })) as unknown as Record<string, unknown>[]
    ).map(toCoverageRecord)
    const byCode = new Map(rows.map((row) => [row.jurisdiction_code, row]))

    const versionsByCode = new Map<string, RuleVersionState[]>()
    if (rows.length > 0) {
      const versions = (await this.listJurisdictionRules(
        { program, jurisdiction_code: rows.map((row) => row.jurisdiction_code) },
        { select: ["jurisdiction_code", "rule_key", "review_status", "superseded_at", "withdrawn_at"], take: null }
      )) as unknown as Array<RuleVersionState & { jurisdiction_code: string }>
      for (const version of versions) {
        const list = versionsByCode.get(version.jurisdiction_code) ?? []
        list.push(version)
        versionsByCode.set(version.jurisdiction_code, list)
      }
    }

    return US_JURISDICTIONS.map((jurisdiction) => {
      const row = byCode.get(jurisdiction.code)
      const required = row?.required_rule_keys ?? []
      const versions = versionsByCode.get(jurisdiction.code) ?? []
      return {
        jurisdiction_code: jurisdiction.code,
        jurisdiction_name: jurisdiction.name,
        program,
        opened: Boolean(row),
        status: row ? coverageStatusOf(required, versions) : "not_covered",
        status_changed_at: row?.status_changed_at ?? null,
        required_rule_keys: required,
        required_keys_not_reviewed: row ? requiredKeysNotReviewed(required, versions) : [],
      }
    })
  }

  // ==================== Writes ====================

  /**
   * Record an archived document, once. The same file (by SHA-256) for the
   * same jurisdiction is never written twice and never changed: a second call
   * returns the row already there, whatever else it was passed.
   */
  async registerSource(input: RegisterSourceInput): Promise<{ source: JurisdictionSourceRecord; created: boolean }> {
    const problems = sourceProblems(input)
    if (problems.length > 0) throw new JurisdictionRuleError("invalid", "This is not a usable source record.", problems)
    return this.registerSourceInTransaction_(input)
  }

  @InjectTransactionManager()
  protected async registerSourceInTransaction_(
    input: RegisterSourceInput,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<{ source: JurisdictionSourceRecord; created: boolean }> {
    const manager = managerOf(sharedContext)
    const inserted = await manager.execute(
      `INSERT INTO "jurisdiction_source"
         ("id", "jurisdiction_code", "issuer", "title", "url", "document_id", "document_date",
          "document_date_note", "retrieved_at", "content_sha256", "archive_ref", "notes")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("jurisdiction_code", "content_sha256") WHERE deleted_at IS NULL DO NOTHING
       RETURNING *`,
      [
        generateEntityId("", "jsrc"),
        input.jurisdiction_code,
        input.issuer,
        input.title,
        input.url ?? null,
        input.document_id ?? null,
        input.document_date ?? null,
        input.document_date_note ?? null,
        input.retrieved_at,
        input.content_sha256,
        input.archive_ref,
        input.notes ?? null,
      ],
      "all"
    )
    if (inserted.length === 1) return { source: inserted[0] as unknown as JurisdictionSourceRecord, created: true }

    const existing = await manager.execute(
      `SELECT * FROM "jurisdiction_source"
        WHERE "jurisdiction_code" = ? AND "content_sha256" = ? AND "deleted_at" IS NULL`,
      [input.jurisdiction_code, input.content_sha256],
      "all"
    )
    return { source: existing[0] as unknown as JurisdictionSourceRecord, created: false }
  }

  /**
   * Open a (jurisdiction, program) and say which rule keys coverage requires.
   * Additive: an existing row keeps the keys it has and gains any new ones;
   * nothing is ever removed here. Called by a seed. There is no route for it,
   * so what "covered" takes cannot be loosened through the API.
   */
  async openCoverage(input: {
    jurisdiction_code: string
    program: string
    required_rule_keys: string[]
  }): Promise<JurisdictionCoverageRecord> {
    const problems: string[] = []
    if (!isUsJurisdictionCode(input.jurisdiction_code)) {
      problems.push("jurisdiction_code must be an ISO 3166-2 code for a US state or DC, such as US-SC")
    }
    if (!(JURISDICTION_PROGRAMS as readonly string[]).includes(input.program)) {
      problems.push(`program must be one of: ${JURISDICTION_PROGRAMS.join(", ")}`)
    }
    if (!Array.isArray(input.required_rule_keys) || input.required_rule_keys.some((key) => !filled(key))) {
      problems.push("required_rule_keys must be a list of rule keys")
    }
    if (problems.length > 0) throw new JurisdictionRuleError("invalid", "This is not a usable coverage record.", problems)
    return this.openCoverageInTransaction_(input)
  }

  @InjectTransactionManager()
  protected async openCoverageInTransaction_(
    input: { jurisdiction_code: string; program: string; required_rule_keys: string[] },
    @MedusaContext() sharedContext: Context = {}
  ): Promise<JurisdictionCoverageRecord> {
    const manager = managerOf(sharedContext)
    await manager.execute(
      `INSERT INTO "jurisdiction_coverage"
         ("id", "jurisdiction_code", "program", "status", "required_rule_keys", "status_changed_at")
       VALUES (?, ?, ?, 'not_covered', CAST(? AS jsonb), now())
       ON CONFLICT ("jurisdiction_code", "program") WHERE deleted_at IS NULL DO NOTHING`,
      [generateEntityId("", "jcov"), input.jurisdiction_code, input.program, JSON.stringify([])],
      "all"
    )
    const current = await this.lockCoverage_(manager, input.jurisdiction_code, input.program)
    if (!current) {
      throw new JurisdictionRuleError("conflict", "The coverage row could not be opened; try again.")
    }
    const merged = [...current.required_rule_keys]
    for (const key of input.required_rule_keys) if (!merged.includes(key)) merged.push(key)
    if (merged.length !== current.required_rule_keys.length) {
      await manager.execute(
        `UPDATE "jurisdiction_coverage" SET "required_rule_keys" = CAST(? AS jsonb), "updated_at" = now() WHERE "id" = ?`,
        [JSON.stringify(merged), current.id],
        "all"
      )
    }
    return (await this.recomputeCoverageLocked_(manager, input.jurisdiction_code, input.program))!
  }

  /**
   * Add a version of a rule, as a draft.
   *
   * The first version of a key is version 1; each later one is the next
   * number. A pending draft for the same key is superseded by the new one. A
   * reviewed version in force is left exactly as it is: it stays in force
   * while the correction waits, and is superseded only when the correction is
   * itself reviewed.
   *
   * Refused when the draft has no citation, when a citation names a source
   * that is not on file for this jurisdiction, or when the jurisdiction has
   * not been opened by a seed.
   */
  async createDraftVersion(
    draft: RuleDraftInput,
    options: CreateDraftVersionOptions = {}
  ): Promise<CreateDraftVersionResult> {
    const problems = ruleDraftProblems(draft)
    if (problems.length > 0) throw new JurisdictionRuleError("invalid", "This is not a usable rule draft.", problems)
    try {
      return await this.createDraftVersionInTransaction_(draft, options)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new JurisdictionRuleError("conflict", "Another version of this rule was written at the same time; reload and try again.")
      }
      throw error
    }
  }

  @InjectTransactionManager()
  protected async createDraftVersionInTransaction_(
    draft: RuleDraftInput,
    options: CreateDraftVersionOptions,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<CreateDraftVersionResult> {
    const manager = managerOf(sharedContext)

    const coverage = await this.lockCoverage_(manager, draft.jurisdiction_code, draft.program)
    if (!coverage) {
      throw new JurisdictionRuleError(
        "not_opened",
        `${draft.jurisdiction_code} has no ${draft.program} coverage on file. A jurisdiction is opened by its seed, which names the archived sources and the rule keys coverage requires.`
      )
    }

    const existing = await manager.execute(
      `SELECT "id", "version" FROM "jurisdiction_rule"
        WHERE "jurisdiction_code" = ? AND "program" = ? AND "rule_key" = ? AND "deleted_at" IS NULL
        ORDER BY "version" DESC`,
      [draft.jurisdiction_code, draft.program, draft.rule_key],
      "all"
    )
    if (options.onlyIfKeyHasNoVersion && existing.length > 0) return { created: false, rule: null }

    // The cited sources must be on file, for this jurisdiction. Their hashes
    // are copied into the citations here, from the rows, so the version's own
    // hash covers the exact files it quotes.
    const sourceIds = [...new Set(draft.citations.map((c) => c.source_id))]
    const sources =
      sourceIds.length === 0
        ? []
        : await manager.execute(
            `SELECT "id", "jurisdiction_code", "content_sha256" FROM "jurisdiction_source"
              WHERE "id" IN (${sourceIds.map(() => "?").join(", ")}) AND "deleted_at" IS NULL`,
            sourceIds,
            "all"
          )
    const sourceById = new Map(sources.map((s) => [String(s.id), s]))
    const sourceProblemsFound: string[] = []
    for (const id of sourceIds) {
      const source = sourceById.get(id)
      if (!source) sourceProblemsFound.push(`citation source ${id} is not on file`)
      else if (source.jurisdiction_code !== draft.jurisdiction_code) {
        sourceProblemsFound.push(`citation source ${id} belongs to ${String(source.jurisdiction_code)}, not ${draft.jurisdiction_code}`)
      }
    }
    if (sourceProblemsFound.length > 0) {
      throw new JurisdictionRuleError("invalid", "A rule can only cite a source on file for its jurisdiction.", sourceProblemsFound)
    }

    const id = generateEntityId("", "jrule")
    const content: RuleContent = {
      jurisdiction_code: draft.jurisdiction_code,
      program: draft.program,
      rule_key: draft.rule_key,
      version: existing.length > 0 ? Number(existing[0].version) + 1 : 1,
      kind: draft.kind,
      value: draft.value ?? null,
      display_text: draft.display_text,
      citations: draft.citations.map((c) => ({
        source_id: c.source_id,
        source_sha256: String(sourceById.get(c.source_id)!.content_sha256),
        locator: c.locator,
        quote: c.quote ?? null,
      })),
      effective_from: draft.effective_from ?? null,
      effective_note: draft.effective_note ?? null,
    }

    const supersededDraft = await manager.execute(
      `UPDATE "jurisdiction_rule"
          SET "superseded_by_rule_id" = ?, "superseded_at" = now(), "updated_at" = now()
        WHERE "jurisdiction_code" = ? AND "program" = ? AND "rule_key" = ?
          AND "review_status" = 'draft' AND "superseded_at" IS NULL AND "withdrawn_at" IS NULL
          AND "deleted_at" IS NULL
    RETURNING "id"`,
      [id, draft.jurisdiction_code, draft.program, draft.rule_key],
      "all"
    )

    const inserted = await manager.execute(
      `INSERT INTO "jurisdiction_rule"
         ("id", "jurisdiction_code", "program", "rule_key", "version", "kind", "value", "display_text",
          "citations", "effective_from", "effective_note", "content_sha256", "review_status")
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, CAST(? AS jsonb), ?, ?, ?, 'draft')
       RETURNING *`,
      [
        id,
        content.jurisdiction_code,
        content.program,
        content.rule_key,
        content.version,
        content.kind,
        content.value === null ? null : JSON.stringify(content.value),
        content.display_text,
        JSON.stringify(content.citations),
        content.effective_from,
        content.effective_note,
        ruleContentSha256(content),
      ],
      "all"
    )

    return {
      created: true,
      rule: toRuleRecord(inserted[0]),
      superseded_draft_id: supersededDraft.length > 0 ? String(supersededDraft[0].id) : null,
      coverage: (await this.recomputeCoverageLocked_(manager, draft.jurisdiction_code, draft.program))!,
    }
  }

  /**
   * Record a sign-off.
   *
   * One transaction, and inside it one statement that decides: an UPDATE that
   * names the version and the hash the reviewer was shown, and matches only
   * while that version is still the pending draft carrying that hash. If it
   * matches nothing, nothing is written, including the supersession of the
   * previous reviewed version, which runs first only because the index that
   * allows one reviewed version in force per key would refuse the other
   * order. Two reviewers at once: the second UPDATE waits for the first and
   * then matches nothing.
   *
   * Who reviewed is the `reviewer` argument, which the route fills from the
   * authenticated session. There is no parameter here through which a request
   * body could name someone else.
   */
  async markReviewed(input: MarkReviewedInput): Promise<MarkReviewedResult> {
    const problems: string[] = []
    if (!filled(input.rule_id)) problems.push("rule_id is required")
    if (typeof input.expected_content_sha256 !== "string" || !SHA256_PATTERN.test(input.expected_content_sha256)) {
      problems.push("expected_content_sha256 must be the 64-character hash of the text that was reviewed")
    }
    if (!filled(input.reviewer?.user_id)) problems.push("reviewer.user_id is required")
    if (problems.length > 0) throw new JurisdictionRuleError("invalid", "This is not a usable sign-off.", problems)
    try {
      return await this.markReviewedInTransaction_(input)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new JurisdictionRuleError("conflict", "This rule changed while it was being reviewed; reload and try again.")
      }
      throw error
    }
  }

  @InjectTransactionManager()
  protected async markReviewedInTransaction_(
    input: MarkReviewedInput,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<MarkReviewedResult> {
    const manager = managerOf(sharedContext)

    const before = await this.readRule_(manager, input.rule_id)
    await this.lockCoverage_(manager, before.jurisdiction_code, before.program)

    const superseded = await manager.execute(
      `UPDATE "jurisdiction_rule"
          SET "superseded_by_rule_id" = ?, "superseded_at" = now(), "updated_at" = now()
        WHERE "jurisdiction_code" = ? AND "program" = ? AND "rule_key" = ? AND "id" <> ?
          AND "review_status" = 'reviewed' AND "superseded_at" IS NULL AND "withdrawn_at" IS NULL
          AND "deleted_at" IS NULL
    RETURNING "id"`,
      [before.id, before.jurisdiction_code, before.program, before.rule_key, before.id],
      "all"
    )

    const reviewed = await manager.execute(
      `UPDATE "jurisdiction_rule"
          SET "review_status" = 'reviewed',
              "reviewed_by_user_id" = ?,
              "reviewer_name" = ?,
              "reviewed_at" = now(),
              "review_note" = ?,
              "updated_at" = now()
        WHERE "id" = ?
          AND "review_status" = 'draft'
          AND "content_sha256" = ?
          AND "superseded_at" IS NULL
          AND "withdrawn_at" IS NULL
          AND "deleted_at" IS NULL
    RETURNING *`,
      [
        input.reviewer.user_id,
        filled(input.reviewer.name) ? input.reviewer.name.trim() : null,
        filled(input.note) ? input.note.trim() : null,
        input.rule_id,
        input.expected_content_sha256,
      ],
      "all"
    )
    if (reviewed.length !== 1) {
      // Thrown inside the transaction: the supersession above rolls back with it.
      throw new JurisdictionRuleError("stale", `Not marked reviewed: ${staleReason(before, input.expected_content_sha256)}. Reload the rule.`)
    }

    const rule = toRuleRecord(reviewed[0])
    if (ruleContentSha256(ruleContentOf(rule)) !== rule.content_sha256) {
      throw new JurisdictionRuleError(
        "integrity",
        "Not marked reviewed: this version's stored text no longer matches its stored hash, so it is not the text that was written. Withdraw it and propose the wording again."
      )
    }

    return {
      rule,
      superseded_rule_id: superseded.length > 0 ? String(superseded[0].id) : null,
      coverage: (await this.recomputeCoverageLocked_(manager, rule.jurisdiction_code, rule.program))!,
    }
  }

  /**
   * Withdraw a version that is in force: a pending draft, or the reviewed
   * version. The row stays, marked with who withdrew it, when and why.
   * Withdrawing the reviewed version leaves its key with no reviewed version,
   * and coverage is recomputed in the same transaction. An earlier version it
   * had superseded does not come back.
   */
  async withdrawRule(
    input: WithdrawRuleInput
  ): Promise<{ rule: JurisdictionRuleRecord; coverage: JurisdictionCoverageRecord }> {
    const problems: string[] = []
    if (!filled(input.rule_id)) problems.push("rule_id is required")
    if (!filled(input.withdrawn_by_user_id)) problems.push("withdrawn_by_user_id is required")
    if (!filled(input.reason)) problems.push("reason is required: say why this version is being withdrawn")
    if (problems.length > 0) throw new JurisdictionRuleError("invalid", "This is not a usable withdrawal.", problems)
    return this.withdrawRuleInTransaction_(input)
  }

  @InjectTransactionManager()
  protected async withdrawRuleInTransaction_(
    input: WithdrawRuleInput,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<{ rule: JurisdictionRuleRecord; coverage: JurisdictionCoverageRecord }> {
    const manager = managerOf(sharedContext)

    const before = await this.readRule_(manager, input.rule_id)
    await this.lockCoverage_(manager, before.jurisdiction_code, before.program)

    const withdrawn = await manager.execute(
      `UPDATE "jurisdiction_rule"
          SET "withdrawn_at" = now(), "withdrawn_by_user_id" = ?, "withdrawn_reason" = ?, "updated_at" = now()
        WHERE "id" = ? AND "withdrawn_at" IS NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL
    RETURNING *`,
      [input.withdrawn_by_user_id, input.reason.trim(), input.rule_id],
      "all"
    )
    if (withdrawn.length !== 1) {
      throw new JurisdictionRuleError(
        "conflict",
        before.withdrawn_at != null
          ? "This version is already withdrawn."
          : "Only a version in force can be withdrawn; this one was replaced by a later version."
      )
    }

    const rule = toRuleRecord(withdrawn[0])
    return {
      rule,
      coverage: (await this.recomputeCoverageLocked_(manager, rule.jurisdiction_code, rule.program))!,
    }
  }

  /**
   * Recompute one coverage row from the rule versions on file and store the
   * result. Null when the jurisdiction has not been opened: there is nothing
   * to store, and it reads `not_covered`.
   */
  async recomputeCoverage(jurisdictionCode: string, program: string): Promise<JurisdictionCoverageRecord | null> {
    return this.recomputeCoverageInTransaction_(jurisdictionCode, program)
  }

  @InjectTransactionManager()
  protected async recomputeCoverageInTransaction_(
    jurisdictionCode: string,
    program: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<JurisdictionCoverageRecord | null> {
    return this.recomputeCoverageLocked_(managerOf(sharedContext), jurisdictionCode, program)
  }

  // ==================== Inside a transaction ====================

  private async readRule_(manager: SqlManager, ruleId: string): Promise<JurisdictionRuleRecord> {
    const rows = await manager.execute(
      `SELECT * FROM "jurisdiction_rule" WHERE "id" = ? AND "deleted_at" IS NULL`,
      [ruleId],
      "all"
    )
    if (rows.length !== 1) throw new JurisdictionRuleError("not_found", "No such rule version.")
    return toRuleRecord(rows[0])
  }

  /** The coverage row, locked until the transaction ends; null when the jurisdiction is not opened. */
  private async lockCoverage_(
    manager: SqlManager,
    jurisdictionCode: string,
    program: string
  ): Promise<JurisdictionCoverageRecord | null> {
    const rows = await manager.execute(
      `SELECT * FROM "jurisdiction_coverage"
        WHERE "jurisdiction_code" = ? AND "program" = ? AND "deleted_at" IS NULL
          FOR UPDATE`,
      [jurisdictionCode, program],
      "all"
    )
    return rows.length === 1 ? toCoverageRecord(rows[0]) : null
  }

  private async recomputeCoverageLocked_(
    manager: SqlManager,
    jurisdictionCode: string,
    program: string
  ): Promise<JurisdictionCoverageRecord | null> {
    const coverage = await this.lockCoverage_(manager, jurisdictionCode, program)
    if (!coverage) return null

    const versions = (await manager.execute(
      `SELECT "rule_key", "review_status", "superseded_at", "withdrawn_at" FROM "jurisdiction_rule"
        WHERE "jurisdiction_code" = ? AND "program" = ? AND "deleted_at" IS NULL`,
      [jurisdictionCode, program],
      "all"
    )) as unknown as RuleVersionState[]

    const status = coverageStatusOf(coverage.required_rule_keys, versions)
    if (status === coverage.status) return coverage

    const updated = await manager.execute(
      `UPDATE "jurisdiction_coverage"
          SET "status" = ?, "status_changed_at" = now(), "updated_at" = now()
        WHERE "id" = ?
    RETURNING *`,
      [status, coverage.id],
      "all"
    )
    return toCoverageRecord(updated[0])
  }
}

export default JurisdictionRulesModuleService
