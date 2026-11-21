import type { Configuration } from "@mikro-orm/core"
import type { AbstractSqlDriver } from "@mikro-orm/knex"
import { Migration20261118CreateJurisdictionRules } from "../migrations/Migration20261118CreateJurisdictionRules"
import { JurisdictionCoverage, JurisdictionRule, JurisdictionSource } from "../models"
import { COVERAGE_STATUSES, RULE_KINDS, RULE_REVIEW_STATUSES } from "../types"

/**
 * DB-less shape check on the hand-kept migration.
 *
 * The module test runner builds its schema from the models, so nothing there
 * reads this file, and the HTTP runner reads nothing else. This is what
 * catches a vocabulary that drifts between `types.ts`, the models and the
 * SQL, a model column the migration forgot, and a `down()` that stops
 * reversing `up()`. The statements themselves are exercised on Postgres by
 * `integration-tests/http/jurisdiction-rules-signoff.spec.ts` and
 * `module-schema-drift.spec.ts`.
 */
function queriesOf(run: (m: Migration20261118CreateJurisdictionRules) => Promise<void> | void): string[] {
  const migration = new Migration20261118CreateJurisdictionRules(
    undefined as unknown as AbstractSqlDriver,
    undefined as unknown as Configuration
  )
  void run(migration)
  return migration.getQueries().map((q) => String(q))
}

const TABLES = {
  jurisdiction_source: JurisdictionSource,
  jurisdiction_rule: JurisdictionRule,
  jurisdiction_coverage: JurisdictionCoverage,
}

describe("Migration20261118CreateJurisdictionRules", () => {
  const upQueries = queriesOf((m) => m.up())
  const up = upQueries.join("\n")
  const down = queriesOf((m) => m.down()).join("\n")
  const createOf = (table: string) => {
    const statement = upQueries.find((q) => q.startsWith(`create table if not exists "${table}"`))
    if (!statement) throw new Error(`no create statement for ${table}`)
    return statement
  }

  it("creates each table idempotently, with every column its model declares and the soft-delete columns", () => {
    for (const [table, model] of Object.entries(TABLES)) {
      const create = createOf(table)
      for (const column of Object.keys(model.schema)) {
        expect(create).toContain(`"${column}" `)
      }
      for (const column of ["created_at", "updated_at", "deleted_at"]) {
        expect(create).toContain(`"${column}" timestamptz`)
      }
    }
  })

  it("CHECK constraints mirror types.ts exactly", () => {
    const values = (table: string, column: string) => {
      const match = createOf(table).match(new RegExp(`check \\("${column}" in \\(([^)]*)\\)\\)`))
      expect(match).not.toBeNull()
      return match![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""))
    }
    expect(values("jurisdiction_rule", "kind")).toEqual([...RULE_KINDS])
    expect(values("jurisdiction_rule", "review_status")).toEqual([...RULE_REVIEW_STATUSES])
    expect(values("jurisdiction_coverage", "status")).toEqual([...COVERAGE_STATUSES])
  })

  it("defaults a new rule to draft and a new coverage row to not_covered", () => {
    expect(createOf("jurisdiction_rule")).toContain(`not null default 'draft'`)
    expect(createOf("jurisdiction_coverage")).toContain(`not null default 'not_covered'`)
  })

  it("refuses, in the table itself, a rule with no citation and a review record that does not add up", () => {
    const create = createOf("jurisdiction_rule")
    expect(create).toContain(
      "constraint jurisdiction_rule_citations_present_check check (CASE WHEN jsonb_typeof(citations) = 'array' THEN jsonb_array_length(citations) >= 1 ELSE false END)"
    )
    expect(create).toContain(
      "constraint jurisdiction_rule_review_record_check check ((review_status = 'reviewed') = (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))"
    )
    expect(create).toContain("constraint jurisdiction_rule_draft_has_no_reviewer_check")
    expect(create).toContain("constraint jurisdiction_rule_content_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$')")
  })

  it("carries the three indexes the rule history depends on, each partial as the model declares it", () => {
    expect(up).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_key_version_unique" ON "jurisdiction_rule" ("jurisdiction_code", "program", "rule_key", "version") WHERE deleted_at IS NULL;`
    )
    expect(up).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_one_reviewed_in_force" ON "jurisdiction_rule" ("jurisdiction_code", "program", "rule_key") WHERE review_status = 'reviewed' AND superseded_at IS NULL AND withdrawn_at IS NULL AND deleted_at IS NULL;`
    )
    expect(up).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jurisdiction_rule_one_pending_draft" ON "jurisdiction_rule" ("jurisdiction_code", "program", "rule_key") WHERE review_status = 'draft' AND superseded_at IS NULL AND withdrawn_at IS NULL AND deleted_at IS NULL;`
    )
  })

  it("creates every index the models name", () => {
    for (const model of Object.values(TABLES)) {
      for (const index of model.parse().indexes ?? []) {
        expect(index.name).toBeDefined()
        expect(up).toContain(`INDEX IF NOT EXISTS "${index.name}"`)
      }
    }
  })

  it("installs the append-only trigger over every content column, and freezes a reviewed row's review record", () => {
    const fn = upQueries.find((q) => q.includes("FUNCTION jurisdiction_rule_refuse_content_change()"))
    expect(fn).toBeDefined()
    for (const column of [
      "jurisdiction_code",
      "program",
      "rule_key",
      "version",
      "kind",
      "value",
      "display_text",
      "citations",
      "effective_from",
      "effective_note",
      "content_sha256",
    ]) {
      expect(fn).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`)
    }
    for (const column of ["review_status", "reviewed_by_user_id", "reviewer_name", "reviewed_at", "review_note"]) {
      expect(fn).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`)
    }
    expect(up).toContain(
      `CREATE TRIGGER "jurisdiction_rule_refuse_content_change" BEFORE UPDATE ON "jurisdiction_rule" FOR EACH ROW EXECUTE PROCEDURE jurisdiction_rule_refuse_content_change();`
    )
  })

  it("down() reverses everything up() created", () => {
    for (const table of Object.keys(TABLES)) expect(down).toContain(`drop table if exists "${table}" cascade;`)
    expect(down).toContain(`DROP TRIGGER IF EXISTS "jurisdiction_rule_refuse_content_change" ON "jurisdiction_rule";`)
    expect(down).toContain(`DROP FUNCTION IF EXISTS jurisdiction_rule_refuse_content_change();`)
    expect(down).not.toMatch(/create /i)
  })
})
