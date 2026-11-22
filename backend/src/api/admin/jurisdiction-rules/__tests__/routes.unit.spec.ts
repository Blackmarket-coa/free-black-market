import { Modules } from "@medusajs/framework/utils"
import { JURISDICTION_RULES_MODULE, JurisdictionRuleError } from "../../../../modules/jurisdiction-rules"
import { GET as listRules, POST as createDraft } from "../route"
import { GET as getRule } from "../[id]/route"
import { POST as review } from "../[id]/review/route"
import { POST as withdraw } from "../[id]/withdraw/route"
import { REVIEWER_ALLOWLIST_ENV } from "../reviewers"

/**
 * The admin rule routes, handler by handler, with the module and the user
 * module doubled. The same routes on a migrated database, through Medusa's
 * admin authentication: `integration-tests/http/jurisdiction-rules-signoff.spec.ts`.
 *
 * The container doubles are keyed by the constants the routes import
 * (`JURISDICTION_RULES_MODULE`, `Modules.USER`) and throw on any other key,
 * so a route resolving a hand-typed key fails here instead of quietly
 * getting nothing.
 *
 * src/api/admin/** is inside the `no-explicit-any` ratchet, so the doubles
 * are typed with narrow local shapes.
 */

type TestRes = {
  statusCode: number
  body: Record<string, unknown> | undefined
  status: (code: number) => TestRes
  json: (payload: Record<string, unknown>) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: Record<string, unknown>) => {
    res.body = payload
    return res
  }
  return res
}

const HASH = "a".repeat(64)
const OTHER_HASH = "b".repeat(64)

const owner = { id: "user_owner", email: "owner@example.com", first_name: "Ada", last_name: "Okafor" }
const other = { id: "user_other", email: "other@example.com", first_name: "Sam", last_name: "Reed" }

const rule = {
  id: "jrule_1",
  jurisdiction_code: "US-SC",
  program: "home_based_food",
  rule_key: "label.statement",
  version: 1,
  citations: [{ source_id: "jsrc_1", source_sha256: HASH, locator: "Labeling, item 4", quote: "A statement" }],
  content_sha256: HASH,
  review_status: "draft",
  standing: "pending_draft",
}

function makeService() {
  return {
    listRuleVersions: jest.fn(async (_filters: Record<string, unknown>) => [rule]),
    listJurisdictionSources: jest.fn(async (_filters: Record<string, unknown>) => [{ id: "jsrc_1" }]),
    createDraftVersion: jest.fn(async (draft: Record<string, unknown>, _options?: { proposedByUserId?: string | null }) => ({
      created: true,
      rule: { ...rule, ...draft },
      superseded_draft_id: null,
      coverage: { status: "draft" },
    })),
    markReviewed: jest.fn(async (input: { rule_id: string; reviewer: { user_id: string; name: string | null } }) => ({
      rule: { ...rule, review_status: "reviewed", reviewed_by_user_id: input.reviewer.user_id, reviewer_name: input.reviewer.name },
      superseded_rule_id: null,
      coverage: { status: "draft" },
    })),
    withdrawRule: jest.fn(async (input: { rule_id: string; withdrawn_by_user_id: string; reason: string }) => ({
      rule: { ...rule, withdrawn_by_user_id: input.withdrawn_by_user_id, withdrawn_reason: input.reason },
      coverage: { status: "draft" },
    })),
  }
}

type Handler = (req: never, res: never) => Promise<unknown>

async function call(
  handler: Handler,
  options: {
    auth?: Record<string, unknown>
    body?: unknown
    params?: Record<string, string>
    query?: Record<string, unknown>
    service?: ReturnType<typeof makeService>
  } = {}
) {
  const service = options.service ?? makeService()
  const retrieveUser = jest.fn(async (id: string) => {
    const user = [owner, other].find((u) => u.id === id)
    if (!user) throw new Error("not found")
    return user
  })
  const resolve = jest.fn((key: string) => {
    if (key === JURISDICTION_RULES_MODULE) return service
    if (key === Modules.USER) return { retrieveUser }
    throw new Error(`unexpected container key: ${key}`)
  })
  const req = {
    params: options.params ?? {},
    query: options.query ?? {},
    body: options.body,
    scope: { resolve },
    auth_context: options.auth,
  }
  const res = createRes()
  await handler(req as never, res as never)
  return { res, service, resolve, retrieveUser }
}

const asUser = (id: string) => ({ actor_id: id, actor_type: "user", auth_identity_id: `authid_${id}` })

describe("POST /admin/jurisdiction-rules/:id/review", () => {
  const original = process.env[REVIEWER_ALLOWLIST_ENV]
  beforeEach(() => {
    process.env[REVIEWER_ALLOWLIST_ENV] = "user_owner"
  })
  afterEach(() => {
    if (original === undefined) delete process.env[REVIEWER_ALLOWLIST_ENV]
    else process.env[REVIEWER_ALLOWLIST_ENV] = original
  })

  const params = { id: "jrule_1" }

  it("marks the version reviewed by the authenticated admin, with the hash they sent", async () => {
    const { res, service } = await call(review as Handler, {
      auth: asUser("user_owner"),
      params,
      body: { expected_content_sha256: HASH, note: "  Checked against CPD Form #2210.  " },
    })
    expect(res.statusCode).toBe(200)
    expect(service.markReviewed).toHaveBeenCalledTimes(1)
    expect(service.markReviewed).toHaveBeenCalledWith({
      rule_id: "jrule_1",
      expected_content_sha256: HASH,
      reviewer: { user_id: "user_owner", name: "Ada Okafor", email: "owner@example.com" },
      note: "Checked against CPD Form #2210.",
    })
  })

  it("ignores a reviewer named in the body: the reviewer recorded is the authenticated admin", async () => {
    const { res, service } = await call(review as Handler, {
      auth: asUser("user_owner"),
      params,
      body: {
        expected_content_sha256: HASH,
        reviewer: { user_id: "user_other", name: "Sam Reed" },
        reviewed_by_user_id: "user_other",
        reviewer_name: "Sam Reed",
        reviewer_user_id: "user_other",
        reviewed_by: "user_other",
        reviewed_at: "2020-01-01T00:00:00Z",
      },
    })
    expect(res.statusCode).toBe(200)
    expect(service.markReviewed).toHaveBeenCalledWith({
      rule_id: "jrule_1",
      expected_content_sha256: HASH,
      reviewer: { user_id: "user_owner", name: "Ada Okafor", email: "owner@example.com" },
      note: null,
    })
    expect(JSON.stringify(service.markReviewed.mock.calls[0])).not.toContain("user_other")
    expect(JSON.stringify(service.markReviewed.mock.calls[0])).not.toContain("Sam Reed")
    expect(JSON.stringify(service.markReviewed.mock.calls[0])).not.toContain("other@example.com")
  })

  it("refuses an admin who is not on the allowlist with 403, and writes nothing", async () => {
    const { res, service } = await call(review as Handler, {
      auth: asUser("user_other"),
      params,
      body: { expected_content_sha256: HASH },
    })
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ type: "not_a_reviewer" })
    expect(service.markReviewed).not.toHaveBeenCalled()
  })

  it("refuses an admin who names the listed reviewer in the body", async () => {
    const { res, service } = await call(review as Handler, {
      auth: asUser("user_other"),
      params,
      body: { expected_content_sha256: HASH, reviewer: { user_id: "user_owner", email: "owner@example.com" }, email: "owner@example.com" },
    })
    expect(res.statusCode).toBe(403)
    expect(service.markReviewed).not.toHaveBeenCalled()
  })

  it("refuses everyone when the allowlist is unset", async () => {
    delete process.env[REVIEWER_ALLOWLIST_ENV]
    for (const id of ["user_owner", "user_other"]) {
      const { res, service } = await call(review as Handler, { auth: asUser(id), params, body: { expected_content_sha256: HASH } })
      expect(res.statusCode).toBe(403)
      expect(res.body).toMatchObject({ type: "not_a_reviewer" })
      expect(service.markReviewed).not.toHaveBeenCalled()
    }
  })

  it("refuses an API key, which is not an admin's own login", async () => {
    const { res, service } = await call(review as Handler, {
      auth: { actor_id: "apk_1", actor_type: "api-key" },
      params,
      body: { expected_content_sha256: HASH },
    })
    expect(res.statusCode).toBe(403)
    expect(service.markReviewed).not.toHaveBeenCalled()
  })

  it("answers who-may-review before anything about the body or the rule", async () => {
    // A non-reviewer sending a malformed body for a rule that does not exist
    // learns only that they are not a reviewer.
    const service = makeService()
    service.markReviewed.mockRejectedValue(new JurisdictionRuleError("not_found", "No such rule version."))
    const { res } = await call(review as Handler, { auth: asUser("user_other"), params: { id: "jrule_missing" }, body: { nonsense: true }, service })
    expect(res.statusCode).toBe(403)
    expect(service.markReviewed).not.toHaveBeenCalled()
  })

  it("requires the hash of the reviewed text, as 64 lowercase hex characters", async () => {
    for (const body of [{}, { expected_content_sha256: "abc" }, { expected_content_sha256: HASH.toUpperCase() }, { expected_content_sha256: 5 }, undefined]) {
      const { res, service } = await call(review as Handler, { auth: asUser("user_owner"), params, body })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_request" })
      expect(service.markReviewed).not.toHaveBeenCalled()
    }
  })

  it("relays a stale hash as 409 stale_review", async () => {
    const service = makeService()
    service.markReviewed.mockRejectedValue(new JurisdictionRuleError("stale", "Not marked reviewed: the content hash sent does not match this version."))
    const { res } = await call(review as Handler, { auth: asUser("user_owner"), params, body: { expected_content_sha256: OTHER_HASH }, service })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "stale_review" })
  })

  it("relays a missing rule as 404, an integrity failure as 409, and rethrows anything it does not know", async () => {
    const service = makeService()
    service.markReviewed.mockRejectedValueOnce(new JurisdictionRuleError("not_found", "No such rule version."))
    expect((await call(review as Handler, { auth: asUser("user_owner"), params, body: { expected_content_sha256: HASH }, service })).res.statusCode).toBe(404)

    service.markReviewed.mockRejectedValueOnce(new JurisdictionRuleError("integrity", "hash mismatch"))
    const integrity = await call(review as Handler, { auth: asUser("user_owner"), params, body: { expected_content_sha256: HASH }, service })
    expect(integrity.res.statusCode).toBe(409)
    expect(integrity.res.body).toMatchObject({ type: "content_hash_mismatch" })

    service.markReviewed.mockRejectedValueOnce(new Error("connection lost"))
    await expect(
      call(review as Handler, { auth: asUser("user_owner"), params, body: { expected_content_sha256: HASH }, service })
    ).rejects.toThrow("connection lost")
  })
})

describe("POST /admin/jurisdiction-rules/:id/withdraw", () => {
  const params = { id: "jrule_1" }

  it("withdraws as the authenticated admin, with the reason given, whoever the body names", async () => {
    const { res, service } = await call(withdraw as Handler, {
      auth: asUser("user_other"),
      params,
      body: { reason: "  The fact sheet was reissued.  ", withdrawn_by_user_id: "user_owner", withdrawn_by: "user_owner" },
    })
    expect(res.statusCode).toBe(200)
    expect(service.withdrawRule).toHaveBeenCalledWith({
      rule_id: "jrule_1",
      withdrawn_by_user_id: "user_other",
      reason: "The fact sheet was reissued.",
    })
  })

  it("does not consult the reviewer allowlist: any admin user may take a rule down", async () => {
    const original = process.env[REVIEWER_ALLOWLIST_ENV]
    delete process.env[REVIEWER_ALLOWLIST_ENV]
    try {
      const { res, service } = await call(withdraw as Handler, { auth: asUser("user_other"), params, body: { reason: "Wrong." } })
      expect(res.statusCode).toBe(200)
      expect(service.withdrawRule).toHaveBeenCalledTimes(1)
    } finally {
      if (original !== undefined) process.env[REVIEWER_ALLOWLIST_ENV] = original
    }
  })

  it("requires a reason", async () => {
    for (const body of [{}, { reason: "" }, { reason: "   " }, undefined]) {
      const { res, service } = await call(withdraw as Handler, { auth: asUser("user_other"), params, body })
      expect(res.statusCode).toBe(400)
      expect(service.withdrawRule).not.toHaveBeenCalled()
    }
  })

  it("refuses an API key: there would be no user to record", async () => {
    const { res, service } = await call(withdraw as Handler, {
      auth: { actor_id: "apk_1", actor_type: "api-key" },
      params,
      body: { reason: "Wrong." },
    })
    expect(res.statusCode).toBe(403)
    expect(service.withdrawRule).not.toHaveBeenCalled()
  })

  it("relays a version that is no longer in force as 409 and a missing one as 404", async () => {
    const service = makeService()
    service.withdrawRule.mockRejectedValueOnce(new JurisdictionRuleError("conflict", "This version is already withdrawn."))
    expect((await call(withdraw as Handler, { auth: asUser("user_other"), params, body: { reason: "x" }, service })).res.statusCode).toBe(409)
    service.withdrawRule.mockRejectedValueOnce(new JurisdictionRuleError("not_found", "No such rule version."))
    expect((await call(withdraw as Handler, { auth: asUser("user_other"), params, body: { reason: "x" }, service })).res.statusCode).toBe(404)
  })
})

describe("POST /admin/jurisdiction-rules", () => {
  const draft = {
    jurisdiction_code: "US-SC",
    rule_key: "label.statement",
    kind: "requirement",
    display_text: "The label must carry this statement.",
    citations: [{ source_id: "jsrc_1", locator: "Labeling, item 4", quote: "A statement" }],
  }

  it("proposes a draft as the authenticated admin, defaulting the program, and answers 201 with the new version", async () => {
    const { res, service } = await call(createDraft as Handler, { auth: asUser("user_other"), body: draft })
    expect(res.statusCode).toBe(201)
    expect(service.createDraftVersion).toHaveBeenCalledWith({ ...draft, program: "home_based_food" }, { proposedByUserId: "user_other" })
    expect(res.body).toMatchObject({ rule: { rule_key: "label.statement" }, superseded_draft_id: null })
  })

  it("refuses an API key, a seller and an unauthenticated request: a proposal records the admin user who made it", async () => {
    for (const auth of [{ actor_id: "apk_1", actor_type: "api-key" }, { actor_id: "sel_1", actor_type: "seller" }, undefined]) {
      const { res, service } = await call(createDraft as Handler, { auth, body: draft })
      expect(res.statusCode).toBe(403)
      expect(res.body).toMatchObject({ type: "forbidden" })
      expect(service.createDraftVersion).not.toHaveBeenCalled()
    }
  })

  it("takes the proposer from the session, never the body", async () => {
    const { res, service } = await call(createDraft as Handler, {
      auth: asUser("user_other"),
      body: { ...draft, proposed_by_user_id: "user_owner" },
    })
    // The schema is strict: a proposer in the body is refused, not used.
    expect(res.statusCode).toBe(400)
    expect(service.createDraftVersion).not.toHaveBeenCalled()
  })

  it("refuses a body that carries a review field, a version or a hash", async () => {
    for (const extra of [
      { review_status: "reviewed" },
      { reviewed_by_user_id: "user_owner" },
      { reviewer_name: "Ada Okafor" },
      { version: 7 },
      { content_sha256: HASH },
    ]) {
      const { res, service } = await call(createDraft as Handler, { auth: asUser("user_other"), body: { ...draft, ...extra } })
      expect(res.statusCode).toBe(400)
      expect(service.createDraftVersion).not.toHaveBeenCalled()
    }
  })

  it("refuses a citation that carries a hash of its own: the service copies it from the source row", async () => {
    const { res, service } = await call(createDraft as Handler, {
      auth: asUser("user_other"),
      body: { ...draft, citations: [{ ...draft.citations[0], source_sha256: HASH }] },
    })
    expect(res.statusCode).toBe(400)
    expect(service.createDraftVersion).not.toHaveBeenCalled()
  })

  it("relays the module's refusal of a draft with no citation as 400, with the reason", async () => {
    const service = makeService()
    service.createDraftVersion.mockRejectedValue(
      new JurisdictionRuleError("invalid", "This is not a usable rule draft.", ["a rule needs at least one citation: the source document and where in it to look"])
    )
    const { res } = await call(createDraft as Handler, { auth: asUser("user_other"), body: { ...draft, citations: [] }, service })
    expect(service.createDraftVersion).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ type: "invalid_request", errors: [expect.stringContaining("at least one citation")] })
  })

  it("relays a jurisdiction no seed has opened as 409", async () => {
    const service = makeService()
    service.createDraftVersion.mockRejectedValue(new JurisdictionRuleError("not_opened", "US-NC has no home_based_food coverage on file."))
    const { res } = await call(createDraft as Handler, { auth: asUser("user_other"), body: { ...draft, jurisdiction_code: "US-NC" }, service })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "jurisdiction_not_opened" })
  })
})

describe("GET /admin/jurisdiction-rules and /:id", () => {
  it("lists every version with the filters given", async () => {
    const { res, service } = await call(listRules as Handler, {
      auth: asUser("user_other"),
      query: { jurisdiction_code: "US-SC", rule_key: "label.statement" },
    })
    expect(res.statusCode).toBe(200)
    expect(service.listRuleVersions).toHaveBeenCalledWith({ jurisdiction_code: "US-SC", rule_key: "label.statement" })
    expect(res.body).toMatchObject({ count: 1 })
  })

  it("returns one version with its history and the sources it cites", async () => {
    const { res, service } = await call(getRule as Handler, { auth: asUser("user_other"), params: { id: "jrule_1" } })
    expect(res.statusCode).toBe(200)
    expect(service.listRuleVersions).toHaveBeenNthCalledWith(1, { id: "jrule_1" })
    expect(service.listRuleVersions).toHaveBeenNthCalledWith(2, {
      jurisdiction_code: "US-SC",
      program: "home_based_food",
      rule_key: "label.statement",
    })
    expect(service.listJurisdictionSources).toHaveBeenCalledWith({ id: ["jsrc_1"] })
    expect(res.body).toMatchObject({ rule: { id: "jrule_1", content_sha256: HASH }, sources: [{ id: "jsrc_1" }] })
  })

  it("answers 404 for a version that does not exist", async () => {
    const service = makeService()
    service.listRuleVersions.mockResolvedValue([])
    const { res } = await call(getRule as Handler, { auth: asUser("user_other"), params: { id: "jrule_missing" }, service })
    expect(res.statusCode).toBe(404)
  })
})
