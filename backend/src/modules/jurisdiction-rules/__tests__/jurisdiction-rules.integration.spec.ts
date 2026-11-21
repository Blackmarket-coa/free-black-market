import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { JURISDICTION_RULES_MODULE } from ".."
import { ruleContentOf, ruleContentSha256 } from "../content-hash"
import { JurisdictionCoverage, JurisdictionRule, JurisdictionSource } from "../models"
import type { RuleDraftInput } from "../rule-draft"
import JurisdictionRulesModuleService, {
  JurisdictionRuleError,
  type JurisdictionRuleRecord,
} from "../service"
import { US_SC_HOME_BASED_FOOD_RULES } from "../seeds/us-sc-home-based-food"
import { seedUsScHomeBasedFood } from "../../../scripts/seed-jurisdiction-rules"

jest.setTimeout(120 * 1000)

/**
 * Real-Postgres coverage for the jurisdiction-rule store.
 *
 * What a stubbed repository cannot show: that version numbers, supersession
 * and the sign-off's one conditional UPDATE hold when two writers arrive
 * together, that the three partial unique indexes refuse what the service is
 * supposed never to attempt, and that a reviewed row comes back unchanged
 * after everything the service can do to it.
 *
 * Requires a database. Run with:
 *   TEST_TYPE=integration:modules pnpm test:integration:modules \
 *     src/modules/jurisdiction-rules/__tests__/jurisdiction-rules.integration.spec.ts
 *
 * Intentionally NOT a *.unit.spec.ts, so the DB-less unit suite skips it. The
 * runner builds the schema from the models: the columns, CHECK constraints
 * and indexes are the migration's, but the append-only trigger is not here
 * (the models cannot express it). The same store on a database built from the
 * migration, trigger included, is
 * `integration-tests/http/jurisdiction-rules-signoff.spec.ts`.
 */
moduleIntegrationTestRunner<JurisdictionRulesModuleService>({
  moduleName: JURISDICTION_RULES_MODULE,
  resolve: "./src/modules/jurisdiction-rules",
  moduleModels: [JurisdictionSource, JurisdictionRule, JurisdictionCoverage],
  testSuite: ({ service, MikroOrmWrapper }) => {
    const SC = "US-SC"
    const PROGRAM = "home_based_food"
    const owner = { user_id: "user_owner", name: "Ada Okafor" }

    const sql = (query: string, params: unknown[] = []) =>
      MikroOrmWrapper.forkManager().execute(query, params) as Promise<Record<string, unknown>[]>

    const refusal = async (attempt: Promise<unknown>): Promise<JurisdictionRuleError> => {
      try {
        await attempt
      } catch (error) {
        if (error instanceof JurisdictionRuleError) return error
        throw error
      }
      throw new Error("expected the call to be refused, and it was not")
    }

    let n = 0
    const sha = () => (++n).toString(16).padStart(64, "0")

    async function source(jurisdiction_code = SC) {
      const { source: row } = await service.registerSource({
        jurisdiction_code,
        issuer: "South Carolina Department of Agriculture",
        title: "A fact sheet",
        url: "https://example.test/fact-sheet.pdf",
        document_id: "Form 1",
        document_date: "2026-05-01",
        retrieved_at: "2026-11-17",
        content_sha256: sha(),
        archive_ref: "docs/sources/us-sc/a-fact-sheet.pdf",
      })
      return row
    }

    /** US-SC opened with the given required keys, and one source to cite. */
    async function opened(required: string[] = ["label.statement"]) {
      const src = await source()
      await service.openCoverage({ jurisdiction_code: SC, program: PROGRAM, required_rule_keys: required })
      return src
    }

    const draftOf = (sourceId: string, change: Partial<RuleDraftInput> = {}): RuleDraftInput => ({
      jurisdiction_code: SC,
      program: PROGRAM,
      rule_key: "label.statement",
      kind: "requirement",
      value: { label_field: "statement" },
      display_text: "The label must carry the statement.",
      citations: [{ source_id: sourceId, locator: "Labeling, item 4", quote: "A statement printed in all capital letters" }],
      ...change,
    })

    async function propose(sourceId: string, change: Partial<RuleDraftInput> = {}): Promise<JurisdictionRuleRecord> {
      const result = await service.createDraftVersion(draftOf(sourceId, change))
      if (!result.created) throw new Error("expected a draft to be written")
      return result.rule
    }

    const versionsOf = (ruleKey = "label.statement") =>
      service.listRuleVersions({ jurisdiction_code: SC, program: PROGRAM, rule_key: ruleKey })

    const byId = async (id: string) => (await service.listRuleVersions({ id }))[0]

    describe("sources", () => {
      it("records an archived document once, and never changes it", async () => {
        const content_sha256 = sha()
        const first = await service.registerSource({
          jurisdiction_code: SC,
          issuer: "SCDA",
          title: "Original title",
          retrieved_at: "2026-11-17",
          content_sha256,
          archive_ref: "docs/sources/us-sc/a.pdf",
        })
        expect(first.created).toBe(true)
        expect(first.source.id).toMatch(/^jsrc_/)
        expect(first.source.document_date).toBeNull()
        expect(first.source.document_id).toBeNull()

        const again = await service.registerSource({
          jurisdiction_code: SC,
          issuer: "SCDA",
          title: "A different title for the same file",
          retrieved_at: "2026-12-01",
          content_sha256,
          archive_ref: "docs/sources/us-sc/a.pdf",
        })
        expect(again.created).toBe(false)
        expect(again.source.id).toBe(first.source.id)
        expect(again.source.title).toBe("Original title")
        expect(again.source.retrieved_at).toBe("2026-11-17")
        expect(await service.listJurisdictionSources({})).toHaveLength(1)
      })

      it("refuses a source without a real hash, date or jurisdiction", async () => {
        const good = {
          jurisdiction_code: SC,
          issuer: "SCDA",
          title: "T",
          retrieved_at: "2026-11-17",
          content_sha256: sha(),
          archive_ref: "docs/sources/us-sc/a.pdf",
        }
        for (const bad of [
          { content_sha256: "abc" },
          { content_sha256: good.content_sha256.toUpperCase().replace(/0/g, "A") },
          { retrieved_at: "17 Nov 2026" },
          { document_date: "5/1/26" },
          { jurisdiction_code: "SC" },
          { url: "http://insecure.example.test/a.pdf" },
          { archive_ref: " " },
        ]) {
          expect((await refusal(service.registerSource({ ...good, ...bad }))).reason).toBe("invalid")
        }
        expect(await service.listJurisdictionSources({})).toHaveLength(0)
      })
    })

    describe("drafts", () => {
      it("writes version 1 as a draft with no reviewer, hashed over its content and the cited file's hash", async () => {
        const src = await opened()
        const rule = await propose(src.id)

        expect(rule.id).toMatch(/^jrule_/)
        expect(rule.version).toBe(1)
        expect(rule.review_status).toBe("draft")
        expect(rule.reviewed_by_user_id).toBeNull()
        expect(rule.reviewer_name).toBeNull()
        expect(rule.reviewed_at).toBeNull()
        expect(rule.effective_from).toBeNull()
        expect(rule.citations).toEqual([
          {
            source_id: src.id,
            source_sha256: src.content_sha256,
            locator: "Labeling, item 4",
            quote: "A statement printed in all capital letters",
          },
        ])
        expect(rule.content_sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(rule.content_sha256).toBe(ruleContentSha256(ruleContentOf(rule)))

        // And the row read back through the generated list says the same.
        const [stored] = await versionsOf()
        expect(stored.content_sha256).toBe(rule.content_sha256)
        expect(ruleContentSha256(ruleContentOf(stored))).toBe(rule.content_sha256)
        expect(stored.standing).toBe("pending_draft")
      })

      it("refuses a rule with no citation, and writes nothing", async () => {
        const src = await opened()
        const error = await refusal(service.createDraftVersion(draftOf(src.id, { citations: [] })))
        expect(error.reason).toBe("invalid")
        expect(error.details).toEqual([expect.stringContaining("at least one citation")])
        expect(await versionsOf()).toHaveLength(0)
      })

      it("refuses a quote-less citation on anything but a not_stated rule", async () => {
        const src = await opened()
        const error = await refusal(
          service.createDraftVersion(draftOf(src.id, { citations: [{ source_id: src.id, locator: "p. 1" }] }))
        )
        expect(error.reason).toBe("invalid")
        const silent = await propose(src.id, {
          rule_key: "sales.annual_cap",
          kind: "not_stated",
          citations: [{ source_id: src.id, locator: "Whole document, read in full" }],
        })
        expect(silent.citations[0].quote).toBeNull()
      })

      it("refuses a citation of a source that is not on file, or belongs to another state", async () => {
        const src = await opened()
        const elsewhere = await source("US-NC")

        const missing = await refusal(
          service.createDraftVersion(draftOf(src.id, { citations: [{ source_id: "jsrc_nope", locator: "p. 1", quote: "Words." }] }))
        )
        expect(missing.reason).toBe("invalid")
        expect(missing.details).toEqual(["citation source jsrc_nope is not on file"])

        const foreign = await refusal(
          service.createDraftVersion(draftOf(src.id, { citations: [{ source_id: elsewhere.id, locator: "p. 1", quote: "Words." }] }))
        )
        expect(foreign.reason).toBe("invalid")
        expect(foreign.details).toEqual([`citation source ${elsewhere.id} belongs to US-NC, not US-SC`])
        expect(await versionsOf()).toHaveLength(0)
      })

      it("refuses a draft for a state no seed has opened", async () => {
        const src = await source()
        const error = await refusal(service.createDraftVersion(draftOf(src.id)))
        expect(error.reason).toBe("not_opened")
        expect(await service.listJurisdictionRules({})).toHaveLength(0)
      })

      it("the database itself refuses a row with no citation", async () => {
        await opened()
        const insert = (citations: string) =>
          sql(
            `INSERT INTO jurisdiction_rule (id, jurisdiction_code, program, rule_key, version, kind, display_text, citations, content_sha256)
             VALUES (?, 'US-SC', 'home_based_food', 'label.statement', 1, 'requirement', 'text', CAST(? AS jsonb), ?)`,
            [`jrule_raw_${++n}`, citations, sha()]
          )
        await expect(insert("[]")).rejects.toThrow(/jurisdiction_rule_citations_present_check/)
        await expect(insert("{}")).rejects.toThrow(/jurisdiction_rule_citations_present_check/)
        await expect(insert('"none"')).rejects.toThrow(/jurisdiction_rule_citations_present_check/)
        expect(await versionsOf()).toHaveLength(0)
      })
    })

    describe("versioning", () => {
      it("numbers versions per rule, supersedes a pending draft, and leaves the reviewed version in force under a correction", async () => {
        const src = await opened()

        const v1 = await propose(src.id, { display_text: "First wording." })
        const v2 = await propose(src.id, { display_text: "Second wording." })
        expect(v2.version).toBe(2)

        // The second draft replaced the first: one pending draft, the other superseded by it.
        let versions = await versionsOf()
        expect(versions.map((v) => [v.version, v.standing])).toEqual([
          [2, "pending_draft"],
          [1, "superseded"],
        ])
        expect((await byId(v1.id)).superseded_by_rule_id).toBe(v2.id)

        const signed = await service.markReviewed({ rule_id: v2.id, expected_content_sha256: v2.content_sha256, reviewer: owner })
        expect(signed.superseded_rule_id).toBeNull()

        // A correction is proposed: the reviewed version stays in force beside it.
        const v3 = await propose(src.id, { display_text: "Third wording." })
        expect(v3.version).toBe(3)
        versions = await versionsOf()
        expect(versions.map((v) => [v.version, v.standing])).toEqual([
          [3, "pending_draft"],
          [2, "reviewed_in_force"],
          [1, "superseded"],
        ])

        // Only when the correction is itself reviewed is the old one superseded, by it.
        const corrected = await service.markReviewed({ rule_id: v3.id, expected_content_sha256: v3.content_sha256, reviewer: owner })
        expect(corrected.superseded_rule_id).toBe(v2.id)
        versions = await versionsOf()
        expect(versions.map((v) => [v.version, v.standing])).toEqual([
          [3, "reviewed_in_force"],
          [2, "superseded"],
          [1, "superseded"],
        ])
        expect((await byId(v2.id)).superseded_by_rule_id).toBe(v3.id)

        // Another rule's versions start again at 1.
        expect((await propose(src.id, { rule_key: "label.product_name" })).version).toBe(1)
      })

      it("gives two drafts proposed at the same moment two different version numbers, and one of them stays pending", async () => {
        const src = await opened()
        const results = await Promise.allSettled([
          service.createDraftVersion(draftOf(src.id, { display_text: "One." })),
          service.createDraftVersion(draftOf(src.id, { display_text: "Two." })),
          service.createDraftVersion(draftOf(src.id, { display_text: "Three." })),
        ])
        expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"])
        const versions = await versionsOf()
        expect(versions.map((v) => v.version)).toEqual([3, 2, 1])
        expect(versions.filter((v) => v.standing === "pending_draft")).toHaveLength(1)
        expect(versions[0].standing).toBe("pending_draft")
      })

      it("the seed's mode writes version 1 only where a rule has no version at all", async () => {
        const src = await opened()
        const first = await service.createDraftVersion(draftOf(src.id), { onlyIfKeyHasNoVersion: true })
        expect(first.created).toBe(true)

        const again = await service.createDraftVersion(draftOf(src.id, { display_text: "Changed in the fixture." }), {
          onlyIfKeyHasNoVersion: true,
        })
        expect(again).toEqual({ created: false, rule: null })

        // Still so when the only version on file was withdrawn: the seed never brings a rule back.
        const [only] = await versionsOf()
        await service.withdrawRule({ rule_id: only.id, withdrawn_by_user_id: "user_other", reason: "Wrong." })
        const afterWithdrawal = await service.createDraftVersion(draftOf(src.id), { onlyIfKeyHasNoVersion: true })
        expect(afterWithdrawal.created).toBe(false)
        expect(await versionsOf()).toHaveLength(1)
      })
    })

    describe("the partial unique indexes", () => {
      const rawInsert = (id: string, version: number, extra: { columns?: string; values?: string } = {}) =>
        sql(
          `INSERT INTO jurisdiction_rule (id, jurisdiction_code, program, rule_key, version, kind, display_text, citations, content_sha256${extra.columns ?? ""})
           VALUES (?, 'US-SC', 'home_based_food', 'label.statement', ?, 'requirement', 'text', CAST('[{"source_id":"x","source_sha256":"y","locator":"z","quote":"q"}]' AS jsonb), ?${extra.values ?? ""})`,
          [id, version, sha()]
        )
      const reviewedColumns = {
        columns: `, review_status, reviewed_by_user_id, reviewed_at`,
        values: `, 'reviewed', 'user_x', now()`,
      }

      it("refuse a second row for the same version of a rule", async () => {
        // One reviewed, one draft, so the version index is the only one in the way.
        await rawInsert("jrule_a", 1, reviewedColumns)
        await expect(rawInsert("jrule_b", 1)).rejects.toThrow(/IDX_jurisdiction_rule_key_version_unique/)
      })

      it("refuse a second pending draft for a rule", async () => {
        await rawInsert("jrule_a", 1)
        await expect(rawInsert("jrule_b", 2)).rejects.toThrow(/IDX_jurisdiction_rule_one_pending_draft/)
      })

      it("refuse a second reviewed version in force for a rule", async () => {
        await rawInsert("jrule_a", 1, reviewedColumns)
        await expect(rawInsert("jrule_b", 2, reviewedColumns)).rejects.toThrow(/IDX_jurisdiction_rule_one_reviewed_in_force/)
      })

      it("allow one reviewed version in force beside one pending draft, and any number of superseded or withdrawn ones", async () => {
        await rawInsert("jrule_a", 1, {
          columns: `, review_status, reviewed_by_user_id, reviewed_at, superseded_at, superseded_by_rule_id`,
          values: `, 'reviewed', 'user_x', now(), now(), 'jrule_c'`,
        })
        await rawInsert("jrule_b", 2, {
          columns: `, withdrawn_at, withdrawn_by_user_id, withdrawn_reason`,
          values: `, now(), 'user_x', 'wrong'`,
        })
        await rawInsert("jrule_c", 3, reviewedColumns)
        await rawInsert("jrule_d", 4)
        expect(await sql(`SELECT id FROM jurisdiction_rule`)).toHaveLength(4)
      })

      it("and the table refuses a review record that does not add up", async () => {
        // Reviewed with nobody named.
        await expect(
          rawInsert("jrule_a", 1, { columns: `, review_status`, values: `, 'reviewed'` })
        ).rejects.toThrow(/jurisdiction_rule_review_record_check/)
        // A draft that names a reviewer.
        await expect(
          rawInsert("jrule_b", 1, { columns: `, reviewer_name`, values: `, 'Mallory'` })
        ).rejects.toThrow(/jurisdiction_rule_draft_has_no_reviewer_check/)
      })
    })

    describe("sign-off", () => {
      it("records the reviewer it was given, when, and the note", async () => {
        const src = await opened()
        const draft = await propose(src.id)

        const { rule } = await service.markReviewed({
          rule_id: draft.id,
          expected_content_sha256: draft.content_sha256,
          reviewer: owner,
          note: "  Checked against the fact sheet.  ",
        })

        expect(rule.review_status).toBe("reviewed")
        expect(rule.reviewed_by_user_id).toBe("user_owner")
        expect(rule.reviewer_name).toBe("Ada Okafor")
        expect(rule.review_note).toBe("Checked against the fact sheet.")
        expect(new Date(rule.reviewed_at as Date).getTime()).toBeGreaterThan(Date.now() - 60_000)
        // The text it was signed for is the text it still carries.
        expect(rule.content_sha256).toBe(draft.content_sha256)
        expect(rule.display_text).toBe(draft.display_text)
      })

      it("writes nothing when the hash sent is not this version's hash", async () => {
        const src = await opened()
        const v1 = await propose(src.id, { display_text: "First wording." })
        await service.markReviewed({ rule_id: v1.id, expected_content_sha256: v1.content_sha256, reviewer: owner })
        const v2 = await propose(src.id, { display_text: "Second wording." })

        // The reviewer was shown v1's text and is signing v2's id.
        const error = await refusal(
          service.markReviewed({ rule_id: v2.id, expected_content_sha256: v1.content_sha256, reviewer: owner })
        )
        expect(error.reason).toBe("stale")
        expect(error.message).toContain("the content hash sent does not match this version")

        // Not reviewed, and the version in force was not superseded on the way to failing.
        const versions = await versionsOf()
        expect(versions.map((v) => [v.version, v.standing])).toEqual([
          [2, "pending_draft"],
          [1, "reviewed_in_force"],
        ])
        expect((await byId(v2.id)).reviewed_by_user_id).toBeNull()
        expect((await byId(v1.id)).superseded_by_rule_id).toBeNull()
      })

      it("refuses a version that is already reviewed, was replaced, or was withdrawn", async () => {
        const src = await opened()
        const v1 = await propose(src.id, { display_text: "First wording." })
        const v2 = await propose(src.id, { display_text: "Second wording." })

        // v1 was replaced by v2 while its reviewer was reading it.
        const replaced = await refusal(
          service.markReviewed({ rule_id: v1.id, expected_content_sha256: v1.content_sha256, reviewer: owner })
        )
        expect(replaced.reason).toBe("stale")
        expect(replaced.message).toContain("replaced by a later one")

        await service.markReviewed({ rule_id: v2.id, expected_content_sha256: v2.content_sha256, reviewer: owner })
        const twice = await refusal(
          service.markReviewed({
            rule_id: v2.id,
            expected_content_sha256: v2.content_sha256,
            reviewer: { user_id: "user_second", name: "Second Reviewer" },
          })
        )
        expect(twice.reason).toBe("stale")
        expect(twice.message).toContain("already reviewed")
        expect((await byId(v2.id)).reviewed_by_user_id).toBe("user_owner")

        const v3 = await propose(src.id, { display_text: "Third wording." })
        await service.withdrawRule({ rule_id: v3.id, withdrawn_by_user_id: "user_other", reason: "Typo." })
        const gone = await refusal(
          service.markReviewed({ rule_id: v3.id, expected_content_sha256: v3.content_sha256, reviewer: owner })
        )
        expect(gone.reason).toBe("stale")
        expect(gone.message).toContain("withdrawn")
        // That refused sign-off would have superseded v2 on its way; it rolled back.
        expect((await byId(v2.id)).standing).toBe("reviewed_in_force")

        expect((await refusal(service.markReviewed({ rule_id: "jrule_nope", expected_content_sha256: v3.content_sha256, reviewer: owner }))).reason).toBe("not_found")
      })

      it("lets exactly one of two reviewers signing the same draft at once through", async () => {
        const src = await opened()
        const draft = await propose(src.id)
        const second = { user_id: "user_second", name: "Second Reviewer" }

        const results = await Promise.allSettled([
          service.markReviewed({ rule_id: draft.id, expected_content_sha256: draft.content_sha256, reviewer: owner }),
          service.markReviewed({ rule_id: draft.id, expected_content_sha256: draft.content_sha256, reviewer: second }),
        ])

        const won = results.filter((r) => r.status === "fulfilled")
        const lost = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]
        expect(won).toHaveLength(1)
        expect(lost).toHaveLength(1)
        expect(lost[0].reason).toBeInstanceOf(JurisdictionRuleError)
        expect((lost[0].reason as JurisdictionRuleError).reason).toBe("stale")

        const stored = await byId(draft.id)
        const winner = (won[0] as PromiseFulfilledResult<{ rule: JurisdictionRuleRecord }>).value.rule
        expect(stored.review_status).toBe("reviewed")
        expect(stored.reviewed_by_user_id).toBe(winner.reviewed_by_user_id)
        expect([owner.user_id, second.user_id]).toContain(stored.reviewed_by_user_id)
      })

      it("refuses to sign a row whose text no longer matches its hash", async () => {
        const src = await opened()
        const draft = await propose(src.id)
        // Edited underneath the service. (On a migrated database the trigger
        // refuses this UPDATE; the runner's schema has no trigger, which is
        // what lets this case be set up at all.)
        await sql(`UPDATE jurisdiction_rule SET display_text = 'Something else entirely.' WHERE id = ?`, [draft.id])

        const error = await refusal(
          service.markReviewed({ rule_id: draft.id, expected_content_sha256: draft.content_sha256, reviewer: owner })
        )
        expect(error.reason).toBe("integrity")
        expect((await byId(draft.id)).review_status).toBe("draft")
      })
    })

    describe("a reviewed row cannot change", () => {
      it("is the same row, field for field, after a correction is proposed, reviewed and withdrawn around it", async () => {
        const src = await opened()
        const v1 = await propose(src.id, { display_text: "First wording." })
        const { rule: reviewed } = await service.markReviewed({
          rule_id: v1.id,
          expected_content_sha256: v1.content_sha256,
          reviewer: owner,
          note: "Signed.",
        })

        const signedFields = (row: JurisdictionRuleRecord) => ({
          ...ruleContentOf(row),
          content_sha256: row.content_sha256,
          review_status: row.review_status,
          reviewed_by_user_id: row.reviewed_by_user_id,
          reviewer_name: row.reviewer_name,
          reviewed_at: new Date(row.reviewed_at as Date).toISOString(),
          review_note: row.review_note,
        })
        const asSigned = signedFields(reviewed)

        // A correction is proposed, replaced, withdrawn, proposed again and reviewed.
        await propose(src.id, { display_text: "Second wording." })
        const v3 = await propose(src.id, { display_text: "Third wording." })
        await service.withdrawRule({ rule_id: v3.id, withdrawn_by_user_id: "user_other", reason: "Typo." })
        expect(signedFields(await byId(v1.id))).toEqual(asSigned)
        expect((await byId(v1.id)).standing).toBe("reviewed_in_force")

        const v4 = await propose(src.id, { display_text: "Fourth wording." })
        await service.markReviewed({
          rule_id: v4.id,
          expected_content_sha256: v4.content_sha256,
          reviewer: { user_id: "user_second", name: "Second Reviewer" },
        })

        // Superseded now, and still exactly what was signed, by whom, when.
        const after = await byId(v1.id)
        expect(after.standing).toBe("superseded")
        expect(after.superseded_by_rule_id).toBe(v4.id)
        expect(signedFields(after)).toEqual(asSigned)
        expect(ruleContentSha256(ruleContentOf(after))).toBe(asSigned.content_sha256)
      })

      it("has no generated write method left open, for rules, sources or coverage", async () => {
        const src = await opened()
        const draft = await propose(src.id)
        const { rule } = await service.markReviewed({ rule_id: draft.id, expected_content_sha256: draft.content_sha256, reviewer: owner })
        const before = await byId(rule.id)

        const generated = service as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
        for (const model of ["JurisdictionRules", "JurisdictionSources", "JurisdictionCoverages"]) {
          for (const verb of ["create", "update", "delete", "softDelete", "restore"]) {
            const method = `${verb}${model}`
            expect(typeof generated[method]).toBe("function")
            const error = await refusal(generated[method]({ id: rule.id, display_text: "Rewritten.", review_status: "draft" }))
            expect(error.reason).toBe("closed")
            expect(error.message).toContain(method)
          }
        }

        expect(await byId(rule.id)).toEqual(before)
        expect(await service.listJurisdictionSources({})).toHaveLength(1)
        expect(await service.listJurisdictionCoverages({})).toHaveLength(1)
      })
    })

    describe("withdrawal", () => {
      it("marks the version with who, when and why, and keeps the row", async () => {
        const src = await opened()
        const draft = await propose(src.id)
        const { rule } = await service.withdrawRule({ rule_id: draft.id, withdrawn_by_user_id: "user_other", reason: "  Misread the list.  " })

        expect(rule.withdrawn_by_user_id).toBe("user_other")
        expect(rule.withdrawn_reason).toBe("Misread the list.")
        expect(rule.withdrawn_at).not.toBeNull()
        expect((await byId(draft.id)).standing).toBe("withdrawn")
        // Content untouched.
        expect(ruleContentSha256(ruleContentOf(await byId(draft.id)))).toBe(draft.content_sha256)
      })

      it("applies only to a version in force", async () => {
        const src = await opened()
        const v1 = await propose(src.id, { display_text: "First wording." })
        const v2 = await propose(src.id, { display_text: "Second wording." })

        const superseded = await refusal(service.withdrawRule({ rule_id: v1.id, withdrawn_by_user_id: "user_other", reason: "x" }))
        expect(superseded.reason).toBe("conflict")

        await service.withdrawRule({ rule_id: v2.id, withdrawn_by_user_id: "user_other", reason: "x" })
        const twice = await refusal(service.withdrawRule({ rule_id: v2.id, withdrawn_by_user_id: "user_third", reason: "y" }))
        expect(twice.reason).toBe("conflict")
        expect((await byId(v2.id)).withdrawn_by_user_id).toBe("user_other")

        expect((await refusal(service.withdrawRule({ rule_id: "jrule_nope", withdrawn_by_user_id: "user_other", reason: "x" }))).reason).toBe("not_found")
        expect((await refusal(service.withdrawRule({ rule_id: v2.id, withdrawn_by_user_id: "user_other", reason: "  " }))).reason).toBe("invalid")
      })

      it("does not bring back the version the withdrawn one had superseded", async () => {
        const src = await opened()
        const v1 = await propose(src.id, { display_text: "First wording." })
        await service.markReviewed({ rule_id: v1.id, expected_content_sha256: v1.content_sha256, reviewer: owner })
        const v2 = await propose(src.id, { display_text: "Second wording." })
        await service.markReviewed({ rule_id: v2.id, expected_content_sha256: v2.content_sha256, reviewer: owner })

        const { coverage } = await service.withdrawRule({ rule_id: v2.id, withdrawn_by_user_id: "user_other", reason: "Wrong." })
        expect(coverage.status).toBe("withdrawn")
        expect((await versionsOf()).map((v) => [v.version, v.standing])).toEqual([
          [2, "withdrawn"],
          [1, "superseded"],
        ])
        const view = await service.getRuleView(SC, PROGRAM, { includeDrafts: true })
        expect(view.rules).toEqual([])
      })
    })

    describe("coverage", () => {
      const KEYS = ["label.statement", "label.product_name", "sales.annual_cap"]

      it("reads covered only when every required key has a reviewed version in force, and drops back on a withdrawal", async () => {
        const src = await opened(KEYS)
        const status = async () => (await service.listCoverage(PROGRAM)).find((c) => c.jurisdiction_code === SC)?.status
        expect(await status()).toBe("not_covered")

        const drafts: JurisdictionRuleRecord[] = []
        for (const rule_key of KEYS) drafts.push(await propose(src.id, { rule_key }))
        expect(await status()).toBe("draft")

        // Reviewed one at a time: covered only with the last one.
        const seen: string[] = []
        const reviewed: JurisdictionRuleRecord[] = []
        for (const draft of drafts) {
          const result = await service.markReviewed({ rule_id: draft.id, expected_content_sha256: draft.content_sha256, reviewer: owner })
          reviewed.push(result.rule)
          seen.push(result.coverage.status)
          expect(await status()).toBe(result.coverage.status)
          expect((await service.getRuleView(SC, PROGRAM, { includeDrafts: false })).coverage.status).toBe(result.coverage.status)
        }
        expect(seen).toEqual(["draft", "draft", "covered"])

        // A pending correction does not disturb it.
        await propose(src.id, { rule_key: KEYS[0], display_text: "A correction." })
        expect(await status()).toBe("covered")
        const viewWithCorrection = await service.getRuleView(SC, PROGRAM, { includeDrafts: true })
        expect(viewWithCorrection.rules.find((r) => r.rule_key === KEYS[0])).toMatchObject({
          review_status: "reviewed",
          correction_pending: true,
          display_text: "The label must carry the statement.",
        })

        // Withdrawing one reviewed rule drops it back, naming the key.
        const { coverage } = await service.withdrawRule({ rule_id: reviewed[1].id, withdrawn_by_user_id: "user_other", reason: "Wrong." })
        expect(coverage.status).toBe("draft")
        expect(await status()).toBe("draft")
        const view = await service.getRuleView(SC, PROGRAM, { includeDrafts: false })
        expect(view.coverage).toMatchObject({ status: "draft", required_keys_not_reviewed: [KEYS[1]] })
        expect(view.rules.map((r) => r.rule_key)).toEqual([KEYS[0], KEYS[2]])
      })

      it("works a reader's answer out from the rules, whatever the stored status says", async () => {
        const src = await opened(KEYS)
        const first = await propose(src.id, { rule_key: KEYS[0] })
        await service.markReviewed({ rule_id: first.id, expected_content_sha256: first.content_sha256, reviewer: owner })
        // One of three reviewed. Someone writes `covered` into the row by hand.
        await sql(`UPDATE jurisdiction_coverage SET status = 'covered'`)

        const listed = (await service.listCoverage(PROGRAM)).find((c) => c.jurisdiction_code === SC)
        expect(listed).toMatchObject({ status: "draft", required_keys_not_reviewed: [KEYS[1], KEYS[2]] })
        expect((await service.getRuleView(SC, PROGRAM, { includeDrafts: true })).coverage.status).toBe("draft")

        // And the next recompute puts the stored value right.
        expect((await service.recomputeCoverage(SC, PROGRAM))?.status).toBe("draft")
        expect((await sql(`SELECT status FROM jurisdiction_coverage`))[0].status).toBe("draft")
      })

      it("reads not_covered for every state without a row, and opens additively", async () => {
        const listed = await service.listCoverage(PROGRAM)
        expect(listed).toHaveLength(51)
        expect(listed.every((c) => c.status === "not_covered" && c.opened === false)).toBe(true)

        const first = await service.openCoverage({ jurisdiction_code: SC, program: PROGRAM, required_rule_keys: ["a.one", "b.two"] })
        expect(first.required_rule_keys).toEqual(["a.one", "b.two"])
        const second = await service.openCoverage({ jurisdiction_code: SC, program: PROGRAM, required_rule_keys: ["b.two", "c.three"] })
        expect(second.id).toBe(first.id)
        expect(second.required_rule_keys).toEqual(["a.one", "b.two", "c.three"])
        // Opening with fewer keys removes none.
        const third = await service.openCoverage({ jurisdiction_code: SC, program: PROGRAM, required_rule_keys: [] })
        expect(third.required_rule_keys).toEqual(["a.one", "b.two", "c.three"])

        const after = await service.listCoverage(PROGRAM)
        expect(after.filter((c) => c.opened).map((c) => c.jurisdiction_code)).toEqual([SC])
        expect(await service.recomputeCoverage("US-NC", PROGRAM)).toBeNull()
      })

      it("shows a reader the reviewed rules only unless drafts are asked for, each with its source", async () => {
        const src = await opened(KEYS)
        const a = await propose(src.id, { rule_key: KEYS[0] })
        await propose(src.id, { rule_key: KEYS[1] })
        await service.markReviewed({ rule_id: a.id, expected_content_sha256: a.content_sha256, reviewer: owner })

        const forBuyers = await service.getRuleView(SC, PROGRAM, { includeDrafts: false })
        expect(forBuyers.rules.map((r) => [r.rule_key, r.review_status])).toEqual([[KEYS[0], "reviewed"]])

        const forSellers = await service.getRuleView(SC, PROGRAM, { includeDrafts: true })
        expect(forSellers.rules.map((r) => [r.rule_key, r.review_status])).toEqual([
          [KEYS[0], "reviewed"],
          [KEYS[1], "draft"],
        ])
        expect(forSellers.rules[0]).toMatchObject({ reviewer_name: "Ada Okafor", effective_from: null })
        expect(forSellers.rules[0].citations[0].source).toMatchObject({
          id: src.id,
          title: "A fact sheet",
          document_id: "Form 1",
          document_date: "2026-05-01",
          content_sha256: src.content_sha256,
        })
        expect(forSellers.jurisdiction_name).toBe("South Carolina")
      })
    })

    describe("the South Carolina seed", () => {
      it("writes two sources and sixteen drafts, coverage draft, and the same rows when run again", async () => {
        const first = await seedUsScHomeBasedFood(service)
        expect(first).toEqual({
          jurisdiction_code: "US-SC",
          program: "home_based_food",
          sources_created: 2,
          sources_already_on_file: 0,
          sources_differing: [],
          rules_created: 16,
          rules_already_on_file: 0,
          coverage_status: "draft",
        })
        const snapshot = async () => ({
          rules: await sql(`SELECT * FROM jurisdiction_rule ORDER BY id`),
          sources: await sql(`SELECT * FROM jurisdiction_source ORDER BY id`),
          coverage: await sql(`SELECT * FROM jurisdiction_coverage ORDER BY id`),
        })
        const before = await snapshot()
        expect(before.rules).toHaveLength(16)
        expect(before.rules.every((r) => r.review_status === "draft" && r.reviewed_by_user_id === null && r.version === 1)).toBe(true)

        const second = await seedUsScHomeBasedFood(service)
        expect(second).toMatchObject({ sources_created: 0, sources_already_on_file: 2, rules_created: 0, rules_already_on_file: 16, coverage_status: "draft" })
        expect(await snapshot()).toEqual(before)

        const view = await service.getRuleView(SC, PROGRAM, { includeDrafts: true })
        expect(view.rules.map((r) => r.rule_key)).toEqual(US_SC_HOME_BASED_FOOD_RULES.map((r) => r.rule_key))
        expect(view.coverage.required_keys_not_reviewed).toHaveLength(16)
      })
    })
  },
})
