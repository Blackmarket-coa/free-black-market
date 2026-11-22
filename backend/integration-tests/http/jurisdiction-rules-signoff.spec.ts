import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { JURISDICTION_RULES_MODULE, JurisdictionRuleError } from "../../src/modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../src/modules/jurisdiction-rules/service"
import {
  US_SC_HOME_BASED_FOOD_RULES,
  US_SC_LABEL_STATEMENT,
  US_SC_SOURCES,
} from "../../src/modules/jurisdiction-rules/seeds/us-sc-home-based-food"
import seedJurisdictionRules from "../../src/scripts/seed-jurisdiction-rules"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { RETIRED_REVIEWER_EMAILS_ENV, REVIEWER_ALLOWLIST_ENV } from "../../src/api/admin/jurisdiction-rules/reviewers"
import { authHeader, createAuthenticatedSeller } from "./helpers/seller-auth"

jest.setTimeout(300 * 1000)

/**
 * The jurisdiction-rule store (Plates pilot, Phase 2) on a database built from
 * the migrations, through Medusa's real admin and seller authentication.
 *
 * What only this shows:
 *
 * - The migration, not the models, built the tables here: the three partial
 *   unique indexes, the CHECK constraints and the guard triggers are the ones
 *   production gets. The module runner builds from the models and has no
 *   triggers, so every trigger is pinned here and only here.
 * - The seed is the operator's script, run the way `medusa exec` runs it.
 * - The reviewer is whoever Medusa's admin authentication says is signed in.
 *   The allowlist is read from the environment at request time, so the cases
 *   below set and unset `JURISDICTION_RULE_REVIEWER_USER_IDS` and
 *   `FF_PLATES_V1` on the running app.
 *
 * Nothing here blocks a sale: the 403 and 409 asserted below are on the admin
 * rule routes (not a reviewer; a stale sign-off), and the seller routes answer
 * only 200, 401 and 404.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const FLAG = PHASE0_FEATURE_FLAGS.PLATES_V1
    const SC = "US-SC"

    const container = () => getContainer() as { resolve: <T = unknown>(key: string) => T }
    const service = () => container().resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
    const pg = () =>
      container().resolve<{ raw: (sql: string, bindings?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }>(
        ContainerRegistrationKeys.PG_CONNECTION
      )
    const rows = async (sql: string, bindings: unknown[] = []) => (await pg().raw(sql, bindings)).rows

    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    type Admin = { id: string; email: string; headers: { headers: { authorization: string } } }

    /** A real admin user and a bearer token Medusa's admin auth accepts. */
    async function asAdmin(names: { first_name?: string; last_name?: string; email?: string } = {}): Promise<Admin> {
      const email = names.email ?? `admin+${uid()}@example.com`
      const [user] = await container()
        .resolve<{ createUsers: (data: Record<string, unknown>[]) => Promise<Array<{ id: string }>> }>(Modules.USER)
        .createUsers([{ ...names, email }])
      const secret = process.env.JWT_SECRET
      if (!secret) throw new Error("JWT_SECRET is not set in the test env")
      const token = jwt.sign(
        { actor_id: user.id, actor_type: "user", auth_identity_id: "", app_metadata: { user_id: user.id } },
        secret,
        { expiresIn: "1h" }
      )
      return { id: user.id, email, headers: { headers: { authorization: `Bearer ${token}` } } }
    }

    /** The owner: an admin whose user id the operator has put on the reviewer list. */
    async function asReviewer(): Promise<Admin> {
      const owner = await asAdmin({ first_name: "Ada", last_name: "Okafor" })
      process.env[REVIEWER_ALLOWLIST_ENV] = `user_someone_else, ${owner.id}`
      return owner
    }

    /** Run `sql` with the named triggers off, then put them back, whatever happens. */
    async function withTriggersOff(table: string, triggers: string[], sql: string, bindings: unknown[] = []) {
      for (const t of triggers) await pg().raw(`ALTER TABLE ${table} DISABLE TRIGGER "${t}"`)
      try {
        await pg().raw(sql, bindings)
      } finally {
        for (const t of triggers) await pg().raw(`ALTER TABLE ${table} ENABLE TRIGGER "${t}"`)
      }
    }

    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)

    const seed = () => seedJurisdictionRules({ container: getContainer(), args: [] } as never)

    type RuleRow = {
      id: string
      rule_key: string
      version: number
      kind: string
      display_text: string
      content_sha256: string
      review_status: string
      reviewed_by_user_id: string | null
      reviewer_name: string | null
      reviewed_at: string | null
      standing: string
      citations: Array<{ source_id: string; source_sha256: string; locator: string; quote: string | null }>
    }

    async function ruleList(admin: Admin, query = `jurisdiction_code=${SC}`): Promise<RuleRow[]> {
      const res = await api.get(`/admin/jurisdiction-rules?${query}`, admin.headers)
      expect(res.status).toBe(200)
      return res.data.rules
    }

    const inForce = (list: RuleRow[], key: string) =>
      list.find((r) => r.rule_key === key && (r.standing === "pending_draft" || r.standing === "reviewed_in_force")) as RuleRow

    const review = (admin: Admin, rule: { id: string; content_sha256: string }, extra: Record<string, unknown> = {}) =>
      call(
        api.post(
          `/admin/jurisdiction-rules/${rule.id}/review`,
          { expected_content_sha256: rule.content_sha256, ...extra },
          admin.headers
        )
      )

    async function coverageOf(admin: Admin) {
      const res = await api.get(`/admin/jurisdiction-coverage`, admin.headers)
      expect(res.status).toBe(200)
      return res.data.jurisdictions.find((j: { jurisdiction_code: string }) => j.jurisdiction_code === SC)
    }

    const snapshot = async () => ({
      sources: await rows(`SELECT * FROM jurisdiction_source ORDER BY id`),
      rules: await rows(`SELECT * FROM jurisdiction_rule ORDER BY id`),
      coverage: await rows(`SELECT * FROM jurisdiction_coverage ORDER BY id`),
    })

    afterEach(() => {
      delete process.env[FLAG]
      delete process.env[REVIEWER_ALLOWLIST_ENV]
      delete process.env[RETIRED_REVIEWER_EMAILS_ENV]
    })

    describe("the migrated schema", () => {
      it("has the three partial unique indexes, the citation check and the guard triggers", async () => {
        const indexes = await rows(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'jurisdiction_rule'`)
        const def = (name: string) => String(indexes.find((i) => i.indexname === name)?.indexdef ?? "")
        expect(def("IDX_jurisdiction_rule_key_version_unique")).toMatch(/UNIQUE INDEX .*\(jurisdiction_code, program, rule_key, version\) WHERE \(deleted_at IS NULL\)/)
        for (const [name, status] of [
          ["IDX_jurisdiction_rule_one_reviewed_in_force", "reviewed"],
          ["IDX_jurisdiction_rule_one_pending_draft", "draft"],
        ]) {
          expect(def(name)).toMatch(/UNIQUE INDEX .*\(jurisdiction_code, program, rule_key\) WHERE/)
          expect(def(name)).toContain(`review_status = '${status}'`)
          expect(def(name)).toContain("superseded_at IS NULL")
          expect(def(name)).toContain("withdrawn_at IS NULL")
          expect(def(name)).toContain("deleted_at IS NULL")
        }

        const checks = (await rows(`SELECT conname FROM pg_constraint WHERE conrelid = 'jurisdiction_rule'::regclass AND contype = 'c'`)).map((c) => c.conname)
        expect(checks).toEqual(
          expect.arrayContaining([
            "jurisdiction_rule_citations_present_check",
            "jurisdiction_rule_review_record_check",
            "jurisdiction_rule_draft_has_no_reviewer_check",
            "jurisdiction_rule_content_sha256_check",
          ])
        )

        const triggersOf = async (table: string) =>
          (
            await rows(`SELECT tgname FROM pg_trigger WHERE tgrelid = ?::regclass AND NOT tgisinternal AND tgenabled = 'O' ORDER BY tgname`, [table])
          ).map((t) => t.tgname)
        expect(await triggersOf("jurisdiction_rule")).toEqual([
          "jurisdiction_rule_guard_insert",
          "jurisdiction_rule_guard_update",
          "jurisdiction_rule_refuse_delete",
        ])
        expect(await triggersOf("jurisdiction_source")).toEqual(["jurisdiction_source_refuse_delete", "jurisdiction_source_refuse_update"])
        expect(await triggersOf("jurisdiction_coverage")).toEqual(["jurisdiction_coverage_guard_update", "jurisdiction_coverage_refuse_delete"])
      })
    })

    describe("the seed", () => {
      it("writes the two sources with their hashes and sixteen draft rules, and the same rows when run again", async () => {
        await seed()
        const first = await snapshot()

        expect(first.sources).toHaveLength(2)
        expect(first.sources.map((s) => s.content_sha256).sort()).toEqual(US_SC_SOURCES.map((s) => s.content_sha256).sort())
        for (const source of first.sources) {
          expect(source.jurisdiction_code).toBe(SC)
          expect(String(source.archive_ref)).toMatch(/^docs\/sources\/us-sc\/.+\.pdf$/)
        }

        expect(first.rules).toHaveLength(16)
        expect(first.rules.map((r) => r.rule_key).sort()).toEqual(US_SC_HOME_BASED_FOOD_RULES.map((r) => r.rule_key).sort())
        for (const rule of first.rules) {
          expect(rule).toMatchObject({
            jurisdiction_code: SC,
            program: "home_based_food",
            version: 1,
            review_status: "draft",
            reviewed_by_user_id: null,
            reviewer_name: null,
            reviewed_at: null,
            review_note: null,
            effective_from: null,
            superseded_at: null,
            withdrawn_at: null,
          })
          expect(rule.proposed_by_user_id).toBeNull()
          expect(rule.reviewer_email).toBeNull()
          const citations = rule.citations as Array<{ source_id: string; source_sha256: string; source: Record<string, unknown>; quote: string | null }>
          expect(citations.length).toBeGreaterThan(0)
          for (const citation of citations) {
            const source = first.sources.find((s) => s.id === citation.source_id)
            expect(source).toBeDefined()
            expect(citation.source_sha256).toBe(source?.content_sha256)
            // The details a reader is shown, copied from the source row and signed with the rule.
            expect(citation.source).toEqual({
              issuer: source?.issuer,
              title: source?.title,
              url: source?.url,
              document_id: source?.document_id,
              document_date: source?.document_date,
              document_date_note: source?.document_date_note,
              retrieved_at: source?.retrieved_at,
              archive_ref: source?.archive_ref,
              notes: source?.notes,
            })
            if (rule.kind === "not_stated") expect(citation.quote).toBeNull()
            else expect(typeof citation.quote).toBe("string")
          }
        }

        // The statement survives the trip through JSONB and TEXT with its apostrophe.
        const statement = first.rules.find((r) => r.rule_key === "label.statement")
        expect((statement?.value as { text: string }).text).toBe(US_SC_LABEL_STATEMENT)
        expect(String(statement?.display_text)).toContain("SOUTH CAROLINA’S FOOD SAFETY REGULATIONS.")

        expect(first.coverage).toHaveLength(1)
        expect(first.coverage[0]).toMatchObject({ jurisdiction_code: SC, program: "home_based_food", status: "draft" })
        expect(first.coverage[0].required_rule_keys).toEqual(US_SC_HOME_BASED_FOOD_RULES.map((r) => r.rule_key))

        await seed()
        expect(await snapshot()).toEqual(first)
      })

      it("never touches a reviewed rule, a review field, or a rule that was withdrawn", async () => {
        const owner = await asReviewer()
        await seed()
        const list = await ruleList(owner)

        const signed = await review(owner, inForce(list, "label.statement"), { note: "Checked." })
        expect(signed.status).toBe(200)
        const withdrawn = await call(
          api.post(`/admin/jurisdiction-rules/${inForce(list, "claims.health").id}/withdraw`, { reason: "Testing." }, owner.headers)
        )
        expect(withdrawn.status).toBe(200)

        const before = await snapshot()
        await seed()
        const after = await snapshot()

        expect(after).toEqual(before)
        expect(after.rules).toHaveLength(16)
        expect(after.rules.find((r) => r.rule_key === "label.statement")).toMatchObject({
          review_status: "reviewed",
          reviewed_by_user_id: owner.id,
          review_note: "Checked.",
        })
        // The withdrawn rule was not given a new version 1 or a version 2.
        expect(after.rules.filter((r) => r.rule_key === "claims.health")).toHaveLength(1)
      })
    })

    describe("the admin rule routes", () => {
      it("are admin-only: no token and a seller's token are both refused", async () => {
        await seed()
        const [anyRule] = await rows(`SELECT id, content_sha256 FROM jurisdiction_rule LIMIT 1`)
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const reads = ["/admin/jurisdiction-rules", `/admin/jurisdiction-rules/${anyRule.id}`, "/admin/jurisdiction-sources", "/admin/jurisdiction-coverage"]

        for (const headers of [{}, authHeader(seller.token)]) {
          for (const path of reads) {
            expect((await call(api.get(path, headers))).status).toBe(401)
          }
          expect((await call(api.post("/admin/jurisdiction-rules", {}, headers))).status).toBe(401)
          expect(
            (await call(api.post(`/admin/jurisdiction-rules/${anyRule.id}/review`, { expected_content_sha256: anyRule.content_sha256 }, headers))).status
          ).toBe(401)
          expect((await call(api.post(`/admin/jurisdiction-rules/${anyRule.id}/withdraw`, { reason: "x" }, headers))).status).toBe(401)
        }
        expect(await rows(`SELECT id FROM jurisdiction_rule WHERE review_status <> 'draft' OR withdrawn_at IS NOT NULL`)).toHaveLength(0)
      })

      it("an admin who is not on the allowlist gets 403 and nothing is written", async () => {
        await asReviewer()
        const other = await asAdmin({ first_name: "Sam", last_name: "Reed" })
        await seed()
        const rule = inForce(await ruleList(other), "label.statement")

        const res = await review(other, rule)
        expect(res.status).toBe(403)
        expect(res.data).toMatchObject({ type: "not_a_reviewer" })
        // A rule that does not exist gets the same answer: the refusal says nothing about the rule.
        expect((await review(other, { id: "jrule_does_not_exist", content_sha256: rule.content_sha256 })).status).toBe(403)

        expect(await rows(`SELECT id FROM jurisdiction_rule WHERE review_status = 'reviewed'`)).toHaveLength(0)
      })

      it("with the allowlist unset, nobody can review, including an admin who was on it", async () => {
        const owner = await asReviewer()
        await seed()
        const rule = inForce(await ruleList(owner), "label.statement")

        delete process.env[REVIEWER_ALLOWLIST_ENV]
        const unset = await review(owner, rule)
        expect(unset.status).toBe(403)
        expect(unset.data).toMatchObject({ type: "not_a_reviewer" })

        process.env[REVIEWER_ALLOWLIST_ENV] = "   "
        expect((await review(owner, rule)).status).toBe(403)
        expect(await rows(`SELECT id FROM jurisdiction_rule WHERE review_status = 'reviewed'`)).toHaveLength(0)

        // The list holds user ids. The owner's email in it admits nobody, and
        // the retired email variable is not read; the refusal says so.
        process.env[REVIEWER_ALLOWLIST_ENV] = owner.email
        expect((await review(owner, rule)).status).toBe(403)
        delete process.env[REVIEWER_ALLOWLIST_ENV]
        process.env[RETIRED_REVIEWER_EMAILS_ENV] = owner.email
        const retired = await review(owner, rule)
        expect(retired.status).toBe(403)
        expect(retired.data.message).toContain("JURISDICTION_RULE_REVIEWER_EMAILS is set but is no longer read")
        expect(await rows(`SELECT id FROM jurisdiction_rule WHERE review_status = 'reviewed'`)).toHaveLength(0)

        process.env[REVIEWER_ALLOWLIST_ENV] = owner.id
        expect((await review(owner, rule)).status).toBe(200)
      })

      it("an admin who deletes the owner and registers the owner's email again cannot sign, and the owner's old login cannot either", async () => {
        const owner = await asReviewer()
        const impostor = await asAdmin({ first_name: "Sam", last_name: "Reed" })
        await seed()
        const rule = inForce(await ruleList(owner), "label.statement")

        // Medusa lets one admin delete another (a soft delete), and the unique
        // index on the email covers live users only.
        const deleted = await call(api.delete(`/admin/users/${owner.id}`, impostor.headers))
        expect(deleted.status).toBe(200)
        const [gone] = await rows(`SELECT deleted_at FROM "user" WHERE id = ?`, [owner.id])
        expect(gone.deleted_at).not.toBeNull()

        // A new admin user with the owner's email and name, as an accepted invite would make.
        const lookalike = await asAdmin({ first_name: "Ada", last_name: "Okafor", email: owner.email })
        expect(lookalike.id).not.toBe(owner.id)

        const forged = await review(lookalike, rule)
        expect(forged.status).toBe(403)
        expect(forged.data).toMatchObject({ type: "not_a_reviewer" })
        // The deleted owner's token admits nobody either: the user is not retrieved.
        expect((await review(owner, rule)).status).toBe(403)
        expect(await rows(`SELECT id FROM jurisdiction_rule WHERE review_status = 'reviewed'`)).toHaveLength(0)
      })

      it("a reviewer named in the body is ignored: the row records the authenticated admin", async () => {
        const owner = await asReviewer()
        const other = await asAdmin({ first_name: "Sam", last_name: "Reed" })
        await seed()
        const rule = inForce(await ruleList(owner), "label.statement")

        const res = await review(owner, rule, {
          note: "Checked against CPD Form #2210.",
          reviewer: { user_id: other.id, name: "Sam Reed", email: other.email },
          reviewed_by_user_id: other.id,
          reviewer_name: "Sam Reed",
          reviewed_by: other.id,
          reviewed_at: "2020-01-01T00:00:00.000Z",
          review_status: "draft",
        })
        expect(res.status).toBe(200)
        expect(res.data.rule).toMatchObject({
          id: rule.id,
          review_status: "reviewed",
          reviewed_by_user_id: owner.id,
          reviewer_name: "Ada Okafor",
          reviewer_email: owner.email,
          review_note: "Checked against CPD Form #2210.",
          content_sha256: rule.content_sha256,
        })

        const [stored] = await rows(`SELECT * FROM jurisdiction_rule WHERE id = ?`, [rule.id])
        expect(stored.reviewed_by_user_id).toBe(owner.id)
        expect(stored.reviewer_name).toBe("Ada Okafor")
        expect(stored.reviewer_email).toBe(owner.email)
        expect(new Date(stored.reviewed_at as string).getFullYear()).toBeGreaterThan(2020)
        expect(JSON.stringify(stored)).not.toContain(other.id)
        expect(JSON.stringify(stored)).not.toContain(other.email)

        // And the other admin naming the owner in the body is still not the owner.
        const second = inForce(await ruleList(owner), "label.ingredients")
        const impersonation = await review(other, second, { reviewer: { user_id: owner.id, email: owner.email }, email: owner.email })
        expect(impersonation.status).toBe(403)
      })

      it("a stale hash gets 409 and nothing is written; the correct hash then goes through, once", async () => {
        const owner = await asReviewer()
        await seed()
        const list = await ruleList(owner)
        const rule = inForce(list, "label.statement")
        const anotherRulesHash = inForce(list, "label.ingredients").content_sha256

        // The reviewer was shown some other text.
        const stale = await review(owner, { id: rule.id, content_sha256: anotherRulesHash })
        expect(stale.status).toBe(409)
        expect(stale.data).toMatchObject({ type: "stale_review" })
        expect((await rows(`SELECT review_status, reviewed_by_user_id FROM jurisdiction_rule WHERE id = ?`, [rule.id]))[0]).toEqual({
          review_status: "draft",
          reviewed_by_user_id: null,
        })

        // Not a hash at all is a 400, not a 409.
        expect((await review(owner, { id: rule.id, content_sha256: "not-a-hash" })).status).toBe(400)

        expect((await review(owner, rule)).status).toBe(200)
        const again = await review(owner, rule)
        expect(again.status).toBe(409)
        expect(again.data).toMatchObject({ type: "stale_review" })
        expect((await review(owner, { id: "jrule_does_not_exist", content_sha256: rule.content_sha256 })).status).toBe(404)
      })

      it("coverage reads covered only after all sixteen keys are reviewed, and withdrawing one drops it back", async () => {
        const owner = await asReviewer()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        process.env[FLAG] = "true"
        await seed()

        const sellerCoverage = async () => {
          const listed = await api.get("/vendor/plates/jurisdictions", authHeader(seller.token))
          const one = await api.get(`/vendor/plates/jurisdictions/${SC}`, authHeader(seller.token))
          return {
            listed: listed.data.jurisdictions.find((j: { code: string }) => j.code === SC).coverage as string,
            detail: one.data.coverage.status as string,
          }
        }

        expect(await coverageOf(owner)).toMatchObject({ status: "draft", opened: true })
        expect((await coverageOf(owner)).required_keys_not_reviewed).toHaveLength(16)
        expect(await sellerCoverage()).toEqual({ listed: "draft", detail: "draft" })

        const drafts = await ruleList(owner)
        expect(drafts).toHaveLength(16)
        const last = drafts[drafts.length - 1]

        for (const rule of drafts.slice(0, -1)) {
          const res = await review(owner, rule)
          expect(res.status).toBe(200)
          expect(res.data.coverage.status).toBe("draft")
        }

        // Fifteen of sixteen: still a draft, everywhere it is read, and the one missing is named.
        expect(await coverageOf(owner)).toMatchObject({ status: "draft", required_keys_not_reviewed: [last.rule_key] })
        expect(await sellerCoverage()).toEqual({ listed: "draft", detail: "draft" })
        expect((await rows(`SELECT status FROM jurisdiction_coverage`))[0].status).toBe("draft")

        // What a reader is told is worked out from the rules, not read from that column:
        // with `covered` written into it by hand, every route still says draft.
        await pg().raw(`UPDATE jurisdiction_coverage SET status = 'covered'`)
        expect(await coverageOf(owner)).toMatchObject({ status: "draft", required_keys_not_reviewed: [last.rule_key] })
        expect(await sellerCoverage()).toEqual({ listed: "draft", detail: "draft" })
        await pg().raw(`UPDATE jurisdiction_coverage SET status = 'draft'`)

        const final = await review(owner, last)
        expect(final.status).toBe(200)
        expect(final.data.coverage.status).toBe("covered")
        expect((await rows(`SELECT status FROM jurisdiction_coverage`))[0].status).toBe("covered")
        expect(await coverageOf(owner)).toMatchObject({ status: "covered", required_keys_not_reviewed: [] })
        expect(await sellerCoverage()).toEqual({ listed: "covered", detail: "covered" })

        // A correction proposed against a reviewed rule leaves coverage where it is.
        const statement = inForce(await ruleList(owner), "label.statement")
        const correction = await call(
          api.post(
            "/admin/jurisdiction-rules",
            {
              jurisdiction_code: SC,
              rule_key: "label.statement",
              kind: "requirement",
              display_text: "A reworded statement rule.",
              citations: [{ source_id: statement.citations[0].source_id, locator: "Labeling, item 4", quote: "A statement printed in all capital letters" }],
            },
            owner.headers
          )
        )
        expect(correction.status).toBe(201)
        expect(correction.data.rule).toMatchObject({ version: 2, review_status: "draft", reviewed_by_user_id: null })
        expect(correction.data.coverage.status).toBe("covered")
        expect(await sellerCoverage()).toEqual({ listed: "covered", detail: "covered" })

        // Withdrawing one reviewed rule drops coverage back. Any admin user may withdraw.
        const other = await asAdmin()
        const cap = inForce(await ruleList(owner), "sales.annual_cap")
        const withdrawn = await call(
          api.post(`/admin/jurisdiction-rules/${cap.id}/withdraw`, { reason: "A source was added.", withdrawn_by_user_id: owner.id }, other.headers)
        )
        expect(withdrawn.status).toBe(200)
        expect(withdrawn.data.rule).toMatchObject({ withdrawn_by_user_id: other.id, withdrawn_reason: "A source was added." })
        expect(withdrawn.data.coverage.status).toBe("draft")
        expect(await coverageOf(owner)).toMatchObject({ status: "draft", required_keys_not_reviewed: ["sales.annual_cap"] })
        expect(await sellerCoverage()).toEqual({ listed: "draft", detail: "draft" })
        // The seller still sees sixteen places, the withdrawn one held by a placeholder.
        const detail = await api.get(`/vendor/plates/jurisdictions/${SC}`, authHeader(seller.token))
        expect(detail.data).toMatchObject({ count: 16, placeholder_count: 1 })
        const capPlace = detail.data.rules.find((r: { rule_key: string }) => r.rule_key === "sales.annual_cap")
        expect(capPlace).toMatchObject({ is_placeholder: true, placeholder_reason: "withdrawn", citations: [] })
        expect(capPlace.display_text).toMatch(/That is not a statement about what is or is not allowed\.$/)

        // Withdrawing it again, or without a reason, is refused.
        expect((await call(api.post(`/admin/jurisdiction-rules/${cap.id}/withdraw`, { reason: "Again." }, other.headers))).status).toBe(409)
        expect((await call(api.post(`/admin/jurisdiction-rules/${statement.id}/withdraw`, {}, other.headers))).status).toBe(400)
      })

      it("a correction is a new version: the reviewed text stays in force until the correction is itself reviewed", async () => {
        const owner = await asReviewer()
        const other = await asAdmin()
        await seed()
        const v1 = inForce(await ruleList(owner), "sales.online_delivery")
        expect((await review(owner, v1)).status).toBe(200)

        // Any admin may propose; the proposal is a draft and names no reviewer.
        const proposed = await call(
          api.post(
            "/admin/jurisdiction-rules",
            {
              jurisdiction_code: SC,
              rule_key: "sales.online_delivery",
              kind: "not_stated",
              display_text: "Not addressed by our sources, reworded.",
              citations: v1.citations.map((c) => ({ source_id: c.source_id, locator: c.locator })),
            },
            other.headers
          )
        )
        expect(proposed.status).toBe(201)
        const v2 = proposed.data.rule as RuleRow
        expect(v2).toMatchObject({ version: 2, review_status: "draft", reviewed_by_user_id: null, proposed_by_user_id: other.id })
        expect(v2.content_sha256).not.toBe(v1.content_sha256)

        const detail = await api.get(`/admin/jurisdiction-rules/${v2.id}`, owner.headers)
        expect(detail.data.history.map((r: RuleRow) => [r.version, r.standing])).toEqual([
          [2, "pending_draft"],
          [1, "reviewed_in_force"],
        ])
        expect(detail.data.sources).toHaveLength(2)

        // Signing v2 with v1's hash (the text that was on screen before the correction) is refused.
        expect((await review(owner, { id: v2.id, content_sha256: v1.content_sha256 })).status).toBe(409)
        expect((await rows(`SELECT superseded_at FROM jurisdiction_rule WHERE id = ?`, [v1.id]))[0].superseded_at).toBeNull()

        const signed = await review(owner, v2)
        expect(signed.status).toBe(200)
        expect(signed.data.superseded_rule_id).toBe(v1.id)
        const history = await ruleList(owner, `jurisdiction_code=${SC}&rule_key=sales.online_delivery`)
        expect(history.map((r) => [r.version, r.standing])).toEqual([
          [2, "reviewed_in_force"],
          [1, "superseded"],
        ])
        // v1 still says what was signed, by whom.
        expect(history[1]).toMatchObject({ content_sha256: v1.content_sha256, reviewed_by_user_id: owner.id, display_text: v1.display_text })
      })

      it("refuses a draft with no citation, an unknown source, a review field in the body, or a state no seed opened", async () => {
        const admin = await asAdmin()
        await seed()
        const [source] = await rows(`SELECT id FROM jurisdiction_source LIMIT 1`)
        const draft = {
          jurisdiction_code: SC,
          rule_key: "label.net_weight",
          kind: "requirement",
          display_text: "A rule nobody sourced.",
          citations: [{ source_id: source.id, locator: "Somewhere", quote: "Some words." }],
        }
        const post = (body: Record<string, unknown>) => call(api.post("/admin/jurisdiction-rules", body, admin.headers))

        const uncited = await post({ ...draft, citations: [] })
        expect(uncited.status).toBe(400)
        expect(uncited.data).toMatchObject({ type: "invalid_request", errors: [expect.stringContaining("at least one citation")] })

        const unquoted = await post({ ...draft, citations: [{ source_id: source.id, locator: "Somewhere" }] })
        expect(unquoted.status).toBe(400)

        const unknownSource = await post({ ...draft, citations: [{ source_id: "jsrc_made_up", locator: "Somewhere", quote: "Some words." }] })
        expect(unknownSource.status).toBe(400)
        expect(unknownSource.data.errors).toEqual(["citation source jsrc_made_up is not on file"])

        for (const extra of [{ review_status: "reviewed" }, { reviewed_by_user_id: admin.id }, { version: 9 }, { content_sha256: "a".repeat(64) }]) {
          expect((await post({ ...draft, ...extra })).status).toBe(400)
        }

        const notOpened = await post({ ...draft, jurisdiction_code: "US-NC" })
        expect(notOpened.status).toBe(409)
        expect(notOpened.data).toMatchObject({ type: "jurisdiction_not_opened" })

        expect(await rows(`SELECT id FROM jurisdiction_rule WHERE rule_key = 'label.net_weight'`)).toHaveLength(0)
        expect(await rows(`SELECT id FROM jurisdiction_rule`)).toHaveLength(16)

        // The service refuses the same thing when called directly, and so does the table.
        await expect(
          service().createDraftVersion({ ...draft, program: "home_based_food", kind: "requirement", citations: [] })
        ).rejects.toBeInstanceOf(JurisdictionRuleError)
        await expect(
          pg().raw(
            `INSERT INTO jurisdiction_rule (id, jurisdiction_code, program, rule_key, version, kind, display_text, citations, content_sha256)
             VALUES ('jrule_raw', 'US-SC', 'home_based_food', 'label.net_weight', 1, 'requirement', 'text', '[]'::jsonb, ?)`,
            ["a".repeat(64)]
          )
        ).rejects.toThrow(/jurisdiction_rule_citations_present_check/)
      })

      it("lists the sources with document id and date, and every state's coverage", async () => {
        const admin = await asAdmin()
        await seed()

        const sources = await api.get(`/admin/jurisdiction-sources?jurisdiction_code=${SC}`, admin.headers)
        expect(sources.status).toBe(200)
        expect(sources.data.count).toBe(2)
        const factSheet = sources.data.sources.find((s: { document_id: string | null }) => s.document_id === "CPD Form #2210")
        expect(factSheet).toMatchObject({
          issuer: "South Carolina Department of Agriculture",
          title: "Home-Based Food Production (Cottage Law)",
          document_date: "2026-05-01",
          content_sha256: "b19c9924721c9219b54f6c859e4733b97e8ad86caa7b29c13df0d8647fe7712c",
          archive_ref: "docs/sources/us-sc/scda-cpd-2210-home-based-food-production-2026-05-01.pdf",
        })
        const faq = sources.data.sources.find((s: { id: string }) => s.id !== factSheet.id)
        expect(faq).toMatchObject({ document_id: null, document_date: null, content_sha256: "f1f6d6f95464188b0cbf261731f562422823dced8eda993fd7a7faeb34a3ef61" })

        const coverage = await api.get(`/admin/jurisdiction-coverage`, admin.headers)
        expect(coverage.data.count).toBe(51)
        const others = coverage.data.jurisdictions.filter((j: { jurisdiction_code: string }) => j.jurisdiction_code !== SC)
        expect(others).toHaveLength(50)
        expect(others.every((j: { status: string; opened: boolean }) => j.status === "not_covered" && j.opened === false)).toBe(true)
      })
    })

    describe("a rule version on a migrated database", () => {
      it("cannot be edited by any UPDATE, and a reviewed one keeps its review record", async () => {
        const owner = await asReviewer()
        await seed()
        const list = await ruleList(owner)
        const draft = inForce(list, "label.ingredients")
        const signedRule = inForce(list, "label.statement")
        expect((await review(owner, signedRule)).status).toBe(200)
        const before = await snapshot()

        // Content: refused on a draft and on a reviewed row alike.
        for (const id of [draft.id, signedRule.id]) {
          for (const change of [
            `display_text = 'Rewritten.'`,
            `citations = '[]'::jsonb`,
            `value = '{"text":"something else"}'::jsonb`,
            `kind = 'permission'`,
            `content_sha256 = '${"0".repeat(64)}'`,
            `version = 9`,
            `effective_from = '2020-01-01'`,
          ]) {
            await expect(pg().raw(`UPDATE jurisdiction_rule SET ${change} WHERE id = ?`, [id])).rejects.toThrow(/append-only/)
          }
        }

        // The review record of a reviewed row: who, when, the note, and the status itself.
        for (const change of [
          `reviewer_name = 'Mallory'`,
          `reviewer_email = 'mallory@example.com'`,
          `reviewed_by_user_id = 'user_mallory'`,
          `reviewed_at = now()`,
          `review_note = 'Rewritten.'`,
          `review_status = 'draft', reviewed_by_user_id = NULL, reviewed_at = NULL, reviewer_name = NULL, reviewer_email = NULL, review_note = NULL`,
        ]) {
          await expect(pg().raw(`UPDATE jurisdiction_rule SET ${change} WHERE id = ?`, [signedRule.id])).rejects.toThrow(
            /review record cannot be changed/
          )
        }

        // A draft cannot be marked reviewed without naming who and when either (the table's own check).
        await expect(pg().raw(`UPDATE jurisdiction_rule SET review_status = 'reviewed' WHERE id = ?`, [draft.id])).rejects.toThrow(
          /jurisdiction_rule_review_record_check/
        )
        // Nor can a second pending draft or a second reviewed version in force be put beside the first.
        const copyOf = (id: string, copyId: string) =>
          `INSERT INTO jurisdiction_rule (id, jurisdiction_code, program, rule_key, version, kind, display_text, citations, content_sha256)
           SELECT '${copyId}', jurisdiction_code, program, rule_key, 2, kind, display_text, citations, content_sha256 FROM jurisdiction_rule WHERE id = '${id}'`
        await expect(pg().raw(copyOf(draft.id, `jrule_copy_${uid()}`))).rejects.toThrow(/IDX_jurisdiction_rule_one_pending_draft/)
        // A second reviewed version has to be inserted as a draft and then marked
        // reviewed (the insert guard allows nothing else); the index refuses the second step.
        const second = `jrule_copy_${uid()}`
        await expect(
          pg().raw(
            `DO $do$ BEGIN
               ${copyOf(signedRule.id, second)};
               UPDATE jurisdiction_rule SET review_status = 'reviewed', reviewed_by_user_id = 'user_x', reviewer_email = 'x@example.com', reviewed_at = now() WHERE id = '${second}';
             END $do$`
          )
        ).rejects.toThrow(/IDX_jurisdiction_rule_one_reviewed_in_force/)

        expect(await snapshot()).toEqual(before)

        // The generated writers are closed on the running app's service too.
        const generated = service() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
        await expect(generated.updateJurisdictionRules({ id: signedRule.id, display_text: "Rewritten." })).rejects.toMatchObject({ reason: "closed" })
        await expect(generated.deleteJurisdictionRules([signedRule.id])).rejects.toMatchObject({ reason: "closed" })
        expect(await snapshot()).toEqual(before)
      })
    })

    describe("the history on a migrated database", () => {
      it("refuses a rule inserted already reviewed, withdrawn or deleted, and a delete or soft delete of any row", async () => {
        const owner = await asReviewer()
        await seed()
        const statement = inForce(await ruleList(owner), "label.statement")
        const before = await snapshot()

        // A pre-reviewed row with false text, as the review measured, and its variants.
        const forged = (columns: string, values: string) =>
          pg().raw(
            `INSERT INTO jurisdiction_rule (id, jurisdiction_code, program, rule_key, version, kind, display_text, citations, content_sha256${columns})
             SELECT '${`jrule_forged_${uid()}`}', jurisdiction_code, program, 'label.forged', 1, kind, 'Sell anything you like.', citations, content_sha256${values}
               FROM jurisdiction_rule WHERE id = '${statement.id}'`
          )
        for (const [columns, values] of [
          [", review_status, reviewed_by_user_id, reviewer_email, reviewed_at", ", 'reviewed', 'user_x', 'x@example.com', now()"],
          [", withdrawn_at, withdrawn_by_user_id, withdrawn_reason", ", now(), 'user_x', 'x'"],
          [", superseded_at, superseded_by_rule_id", ", now(), 'jrule_x'"],
          [", deleted_at", ", now()"],
        ]) {
          await expect(forged(columns, values)).rejects.toThrow(/must be written as a draft/)
        }

        // No row of the three tables is deleted, or soft-deleted.
        await expect(pg().raw(`DELETE FROM jurisdiction_rule WHERE id = ?`, [statement.id])).rejects.toThrow(/jurisdiction_rule rows are never deleted/)
        await expect(pg().raw(`DELETE FROM jurisdiction_source`)).rejects.toThrow(/jurisdiction_source rows are never deleted/)
        await expect(pg().raw(`DELETE FROM jurisdiction_coverage`)).rejects.toThrow(/jurisdiction_coverage rows are never deleted/)
        await expect(pg().raw(`UPDATE jurisdiction_rule SET deleted_at = now() WHERE id = ?`, [statement.id])).rejects.toThrow(
          /never deleted or restored/
        )

        expect(await snapshot()).toEqual(before)
      })

      it("keeps a withdrawal, a supersession and a proposer as written, a source unchanged, and coverage's required keys from shrinking", async () => {
        const owner = await asReviewer()
        const other = await asAdmin()
        await seed()
        const list = await ruleList(owner)

        // A withdrawn rule cannot be revived by clearing its withdrawal.
        const health = inForce(list, "claims.health")
        expect((await call(api.post(`/admin/jurisdiction-rules/${health.id}/withdraw`, { reason: "Testing." }, owner.headers))).status).toBe(200)
        for (const change of [
          `withdrawn_at = NULL, withdrawn_by_user_id = NULL, withdrawn_reason = NULL`,
          `withdrawn_reason = 'Something else.'`,
          `withdrawn_by_user_id = 'user_mallory'`,
        ]) {
          await expect(pg().raw(`UPDATE jurisdiction_rule SET ${change} WHERE id = ?`, [health.id])).rejects.toThrow(
            /withdrawal cannot be changed/
          )
        }

        // A superseded version cannot be put back in force.
        const v1 = inForce(list, "sales.online_delivery")
        expect((await review(owner, v1)).status).toBe(200)
        const proposed = await call(
          api.post(
            "/admin/jurisdiction-rules",
            {
              jurisdiction_code: SC,
              rule_key: "sales.online_delivery",
              kind: "not_stated",
              display_text: "Not addressed by our sources, reworded.",
              citations: v1.citations.map((c) => ({ source_id: c.source_id, locator: c.locator })),
            },
            other.headers
          )
        )
        expect((await review(owner, proposed.data.rule)).status).toBe(200)
        for (const change of [`superseded_at = NULL, superseded_by_rule_id = NULL`, `superseded_by_rule_id = 'jrule_other'`]) {
          await expect(pg().raw(`UPDATE jurisdiction_rule SET ${change} WHERE id = ?`, [v1.id])).rejects.toThrow(
            /supersession cannot be changed/
          )
        }
        await expect(
          pg().raw(`UPDATE jurisdiction_rule SET proposed_by_user_id = 'user_mallory' WHERE id = ?`, [proposed.data.rule.id])
        ).rejects.toThrow(/append-only/)

        // A source is immutable.
        const [source] = await rows(`SELECT id FROM jurisdiction_source LIMIT 1`)
        for (const change of [`title = 'Another title'`, `document_id = 'CPD Form #9999'`, `document_date = '2019-01-01'`, `content_sha256 = '${"f".repeat(64)}'`, `deleted_at = now()`]) {
          await expect(pg().raw(`UPDATE jurisdiction_source SET ${change} WHERE id = ?`, [source.id])).rejects.toThrow(/is immutable/)
        }

        // Coverage's required keys only grow; it cannot be re-pointed or soft-deleted.
        await expect(pg().raw(`UPDATE jurisdiction_coverage SET required_rule_keys = '["label.statement"]'::jsonb`)).rejects.toThrow(/only grows/)
        await expect(pg().raw(`UPDATE jurisdiction_coverage SET required_rule_keys = '[]'::jsonb`)).rejects.toThrow(/only grows/)
        for (const change of [`jurisdiction_code = 'US-NC'`, `program = 'other'`, `deleted_at = now()`]) {
          await expect(pg().raw(`UPDATE jurisdiction_coverage SET ${change}`)).rejects.toThrow(/cannot be re-pointed, deleted or restored/)
        }
        // Growing is allowed (rolled back here, so the row stays as the seed left it).
        await expect(
          pg().raw(
            `DO $do$ BEGIN
               UPDATE jurisdiction_coverage SET required_rule_keys = required_rule_keys || '["label.extra"]'::jsonb;
               RAISE EXCEPTION 'grew, rolling back';
             END $do$`
          )
        ).rejects.toThrow(/grew, rolling back/)
        expect((await rows(`SELECT required_rule_keys FROM jurisdiction_coverage`))[0].required_rule_keys).toEqual(
          US_SC_HOME_BASED_FOOD_RULES.map((r) => r.rule_key)
        )
      })

      it("shows a seller neither a reviewed rule whose text no longer matches its hash, nor a source changed under a signed rule", async () => {
        const owner = await asReviewer()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        await seed()
        process.env[FLAG] = "true"
        const list = await ruleList(owner)
        for (const rule of list) expect((await review(owner, rule)).status).toBe(200)
        const detail = async () => (await api.get(`/vendor/plates/jurisdictions/${SC}`, authHeader(seller.token))).data
        expect((await detail()).coverage.status).toBe("covered")

        // Only with the guards switched off can the rows be changed at all.
        const statement = inForce(list, "label.statement")
        await withTriggersOff(
          "jurisdiction_rule",
          ["jurisdiction_rule_guard_update"],
          `UPDATE jurisdiction_rule SET display_text = 'Sell anything you like.' WHERE id = ?`,
          [statement.id]
        )
        await withTriggersOff(
          "jurisdiction_source",
          ["jurisdiction_source_refuse_update"],
          `UPDATE jurisdiction_source SET title = 'Another title', document_id = 'CPD Form #9999', document_date = '2019-01-01', content_sha256 = ? WHERE document_id = 'CPD Form #2210'`,
          ["f".repeat(64)]
        )

        const after = await detail()
        expect(JSON.stringify(after)).not.toContain("Sell anything you like.")
        expect(after.rules.find((r: { rule_key: string }) => r.rule_key === "label.statement")).toMatchObject({
          is_placeholder: true,
          placeholder_reason: "unavailable",
        })
        expect(after.coverage).toMatchObject({ status: "draft", required_keys_not_reviewed: ["label.statement"] })
        expect(await coverageOf(owner)).toMatchObject({ status: "draft", required_keys_not_reviewed: ["label.statement"] })

        // Every source shown is the copy signed with its rule, whatever the row says now.
        const ingredients = after.rules.find((r: { rule_key: string }) => r.rule_key === "label.ingredients")
        expect(ingredients.citations[1].source).toMatchObject({
          title: "Home-Based Food Production (Cottage Law)",
          document_id: "CPD Form #2210",
          document_date: "2026-05-01",
          content_sha256: "b19c9924721c9219b54f6c859e4733b97e8ad86caa7b29c13df0d8647fe7712c",
        })
        expect(JSON.stringify(after)).not.toContain("CPD Form #9999")
      })
    })

    describe("/vendor/plates", () => {
      it("answers 404 with the flag off, for a signed-in seller, on both routes", async () => {
        const seller = await createAuthenticatedSeller({ api, getContainer })
        await seed()

        for (const value of [undefined, "false", "1", "TRUE"]) {
          if (value === undefined) delete process.env[FLAG]
          else process.env[FLAG] = value
          for (const path of ["/vendor/plates/jurisdictions", `/vendor/plates/jurisdictions/${SC}`]) {
            const res = await call(api.get(path, authHeader(seller.token)))
            expect(res.status).toBe(404)
            expect(res.data).toEqual({ type: "feature_disabled", message: "Feature flag FF_PLATES_V1 is disabled" })
            // Authentication runs before the flag, as for every flagged vendor route: no token is 401 either way.
            expect((await call(api.get(path))).status).toBe(401)
          }
        }

        // The admin rule routes are not behind the flag: sign-off happens before it is set.
        const admin = await asAdmin()
        expect((await api.get("/admin/jurisdiction-rules", admin.headers)).status).toBe(200)
      })

      it("with the flag on, needs a seller, and shows every state with South Carolina as the only one on file", async () => {
        const seller = await createAuthenticatedSeller({ api, getContainer })
        await seed()
        process.env[FLAG] = "true"

        for (const path of ["/vendor/plates/jurisdictions", `/vendor/plates/jurisdictions/${SC}`]) {
          expect((await call(api.get(path))).status).toBe(401)
        }

        const res = await api.get("/vendor/plates/jurisdictions", authHeader(seller.token))
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ program: "home_based_food", count: 51 })
        expect(res.data.jurisdictions.find((j: { code: string }) => j.code === SC)).toMatchObject({ name: "South Carolina", coverage: "draft" })
        expect(res.data.jurisdictions.filter((j: { coverage: string }) => j.coverage !== "not_covered")).toHaveLength(1)

        // A state with nothing on file is an answer, not an error; a non-state is 404.
        const nc = await api.get("/vendor/plates/jurisdictions/US-NC", authHeader(seller.token))
        expect(nc.status).toBe(200)
        expect(nc.data).toMatchObject({ jurisdiction: { code: "US-NC", name: "North Carolina" }, coverage: { status: "not_covered" }, rules: [], count: 0 })
        expect((await call(api.get("/vendor/plates/jurisdictions/US-ZZ", authHeader(seller.token)))).status).toBe(404)
      })

      it("shows each rule with its source, document id and date, marks drafts, and reads not stated where the documents are silent", async () => {
        const owner = await asReviewer()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        await seed()
        process.env[FLAG] = "true"
        const statementRow = inForce(await ruleList(owner), "label.statement")
        expect((await review(owner, statementRow)).status).toBe(200)

        const res = await api.get(`/vendor/plates/jurisdictions/sc`, authHeader(seller.token))
        expect(res.status).toBe(200)
        expect(res.data.jurisdiction).toEqual({ code: SC, name: "South Carolina" })
        expect(res.data.coverage.status).toBe("draft")
        // All sixteen, in the order coverage requires them.
        expect(res.data.rules.map((r: { rule_key: string }) => r.rule_key)).toEqual(US_SC_HOME_BASED_FOOD_RULES.map((r) => r.rule_key))

        type SellerRule = {
          rule_key: string
          kind: string
          display_text: string
          value: Record<string, unknown>
          is_draft: boolean
          review_status: string
          reviewed_at: string | null
          reviewer_name: string | null
          effective_from: string | null
          effective_date_text: string
          citations: Array<{ locator: string; quote: string | null; source: Record<string, unknown> }>
        }
        const rules = res.data.rules as SellerRule[]

        for (const rule of rules) {
          // No source states an effective date.
          expect(rule.effective_from).toBeNull()
          expect(rule.effective_date_text).toBe("not stated")
          expect(rule.citations.length).toBeGreaterThan(0)
          for (const citation of rule.citations) {
            expect(citation.source).toMatchObject({ issuer: "South Carolina Department of Agriculture" })
            expect(typeof citation.source.title).toBe("string")
            expect(typeof citation.source.document_id_text).toBe("string")
            expect(typeof citation.source.document_date_text).toBe("string")
            expect(citation.source.content_sha256).toMatch(/^[0-9a-f]{64}$/)
          }
        }

        const statement = rules.find((r) => r.rule_key === "label.statement") as SellerRule
        expect(statement).toMatchObject({ review_status: "reviewed", is_draft: false, reviewer_name: "Ada Okafor" })
        expect(new Date(statement.reviewed_at as string).getTime()).toBeGreaterThan(Date.now() - 5 * 60_000)
        expect(statement.value.text).toBe(US_SC_LABEL_STATEMENT)
        expect(statement.citations[1].source).toMatchObject({
          title: "Home-Based Food Production (Cottage Law)",
          document_id: "CPD Form #2210",
          document_id_text: "CPD Form #2210",
          document_date: "2026-05-01",
          document_date_text: "2026-05-01",
        })

        // Everything else is still a draft, and says so.
        const drafts = rules.filter((r) => r.rule_key !== "label.statement")
        expect(drafts).toHaveLength(15)
        for (const rule of drafts) {
          expect(rule).toMatchObject({ review_status: "draft", is_draft: true, reviewed_at: null, reviewer_name: null })
        }

        // Online orders and delivery: a rule in its own right, saying the sources are silent,
        // citing both documents, one of which prints neither an id nor a date.
        const online = rules.find((r) => r.rule_key === "sales.online_delivery") as SellerRule
        expect(online.kind).toBe("not_stated")
        expect(online.display_text).toMatch(/^Not addressed by our sources/)
        expect(online.citations.map((c) => c.quote)).toEqual([null, null])
        const faq = online.citations.map((c) => c.source).find((s) => s.document_id === null)
        expect(faq).toMatchObject({
          title: "Are you interested in selling food out of your home?",
          document_id: null,
          document_id_text: "not stated",
          document_date: null,
          document_date_text: "not stated",
        })
        expect(String(faq?.document_date_note)).toMatch(/No date or form number is printed/)
      })
    })
  },
})
