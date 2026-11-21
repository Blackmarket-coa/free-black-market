import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  REVIEWER_ALLOWLIST_ENV,
  adminUserIdOf,
  onReviewerAllowlist,
  resolveReviewer,
  reviewerAllowlist,
} from "../reviewers"

/**
 * The reviewer allowlist: who may turn a draft rule into reviewed text.
 *
 * src/api/admin/** is inside the `no-explicit-any` ratchet, so the doubles
 * are typed with narrow local shapes.
 */

type User = { id: string; email?: string | null; first_name?: string | null; last_name?: string | null }

function makeReq(auth: Record<string, unknown> | undefined, users: User[] = []) {
  const retrieveUser = jest.fn(async (id: string) => {
    const user = users.find((u) => u.id === id)
    if (!user) throw new Error(`User with id: ${id} was not found`)
    return user
  })
  const resolve = jest.fn((key: string) => {
    if (key === Modules.USER) return { retrieveUser }
    throw new Error(`unexpected container key: ${key}`)
  })
  const req = { auth_context: auth, scope: { resolve }, body: {} } as unknown as MedusaRequest
  return { req, retrieveUser, resolve }
}

const asUser = (id: string) => ({ actor_id: id, actor_type: "user" })

describe("reviewer allowlist", () => {
  const original = process.env[REVIEWER_ALLOWLIST_ENV]
  afterEach(() => {
    if (original === undefined) delete process.env[REVIEWER_ALLOWLIST_ENV]
    else process.env[REVIEWER_ALLOWLIST_ENV] = original
  })

  it("is read from JURISDICTION_RULE_REVIEWER_EMAILS", () => {
    expect(REVIEWER_ALLOWLIST_ENV).toBe("JURISDICTION_RULE_REVIEWER_EMAILS")
  })

  it("admits nobody when the variable is unset, empty or only separators", () => {
    for (const raw of [undefined, "", "   ", ",", " , ; \n"]) {
      expect(reviewerAllowlist(raw)).toEqual([])
      expect(onReviewerAllowlist("owner@example.com", raw)).toBe(false)
      expect(onReviewerAllowlist("", raw)).toBe(false)
    }
  })

  it("reads entries separated by commas, semicolons or whitespace", () => {
    expect(reviewerAllowlist("owner@example.com, second@example.com;third@example.com\nfourth@example.com")).toEqual([
      "owner@example.com",
      "second@example.com",
      "third@example.com",
      "fourth@example.com",
    ])
  })

  it("matches the stored email exactly", () => {
    const list = "owner@example.com,second@example.com"
    expect(onReviewerAllowlist("owner@example.com", list)).toBe(true)
    expect(onReviewerAllowlist("second@example.com", list)).toBe(true)
    expect(onReviewerAllowlist("third@example.com", list)).toBe(false)
    expect(onReviewerAllowlist("owner@example.com.evil.test", list)).toBe(false)
    expect(onReviewerAllowlist("xowner@example.com", list)).toBe(false)
  })

  it("does not match a different letter case or surrounding space, which another admin could register", () => {
    // Medusa keeps admin emails unique as exact strings, and an invite can be
    // accepted under any email not already taken. A lenient comparison would
    // let `Owner@Example.com` be created beside the real reviewer and pass.
    const list = "owner@example.com"
    for (const lookalike of ["Owner@example.com", "OWNER@EXAMPLE.COM", "owner@Example.com", " owner@example.com", "owner@example.com "]) {
      expect(onReviewerAllowlist(lookalike, list)).toBe(false)
    }
  })

  it("matches nothing that is not a non-empty string", () => {
    for (const email of [null, undefined, 42, {}, ["owner@example.com"]]) {
      expect(onReviewerAllowlist(email, "owner@example.com")).toBe(false)
    }
  })

  it("reads the environment at call time, not at import", () => {
    delete process.env[REVIEWER_ALLOWLIST_ENV]
    expect(onReviewerAllowlist("owner@example.com")).toBe(false)
    process.env[REVIEWER_ALLOWLIST_ENV] = "owner@example.com"
    expect(onReviewerAllowlist("owner@example.com")).toBe(true)
  })
})

describe("adminUserIdOf", () => {
  it("is the actor id of an admin user, and null for anything else", () => {
    expect(adminUserIdOf(makeReq(asUser("user_1")).req)).toBe("user_1")
    expect(adminUserIdOf(makeReq({ actor_id: "apk_1", actor_type: "api-key" }).req)).toBeNull()
    expect(adminUserIdOf(makeReq({ actor_id: "sel_1", actor_type: "seller" }).req)).toBeNull()
    expect(adminUserIdOf(makeReq({ actor_id: "", actor_type: "user" }).req)).toBeNull()
    expect(adminUserIdOf(makeReq({ actor_type: "user" }).req)).toBeNull()
    expect(adminUserIdOf(makeReq(undefined).req)).toBeNull()
  })
})

describe("resolveReviewer", () => {
  const original = process.env[REVIEWER_ALLOWLIST_ENV]
  beforeEach(() => {
    process.env[REVIEWER_ALLOWLIST_ENV] = "owner@example.com"
  })
  afterEach(() => {
    if (original === undefined) delete process.env[REVIEWER_ALLOWLIST_ENV]
    else process.env[REVIEWER_ALLOWLIST_ENV] = original
  })

  const owner: User = { id: "user_owner", email: "owner@example.com", first_name: "Ada", last_name: "Okafor" }
  const other: User = { id: "user_other", email: "other@example.com", first_name: "Sam", last_name: "Reed" }

  it("resolves an allowlisted admin from the user module, by the authenticated actor id", async () => {
    const { req, retrieveUser } = makeReq(asUser("user_owner"), [owner, other])
    const result = await resolveReviewer(req)
    expect(result).toEqual({ ok: true, reviewer: { user_id: "user_owner", name: "Ada Okafor", email: "owner@example.com" } })
    expect(retrieveUser).toHaveBeenCalledWith("user_owner")
  })

  it("refuses an admin who is not on the list, with 403", async () => {
    const { req } = makeReq(asUser("user_other"), [owner, other])
    const result = await resolveReviewer(req)
    expect(result).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
  })

  it("refuses everyone when the variable is unset, the listed owner included, without looking anyone up", async () => {
    delete process.env[REVIEWER_ALLOWLIST_ENV]
    const { req, retrieveUser } = makeReq(asUser("user_owner"), [owner])
    const result = await resolveReviewer(req)
    expect(result).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
    expect((result as { message: string }).message).toContain("JURISDICTION_RULE_REVIEWER_EMAILS is not set")
    expect(retrieveUser).not.toHaveBeenCalled()
  })

  it("refuses an API key, a seller and an unauthenticated request", async () => {
    for (const auth of [{ actor_id: "apk_1", actor_type: "api-key" }, { actor_id: "user_owner", actor_type: "seller" }, undefined]) {
      const { req, retrieveUser } = makeReq(auth, [owner])
      expect(await resolveReviewer(req)).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
      expect(retrieveUser).not.toHaveBeenCalled()
    }
  })

  it("refuses when the user cannot be found, or has no email", async () => {
    expect(await resolveReviewer(makeReq(asUser("user_gone"), [owner]).req)).toMatchObject({ ok: false, status: 403 })
    expect(await resolveReviewer(makeReq(asUser("user_blank"), [{ id: "user_blank", email: null }]).req)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it("never reads the request body: a body naming the owner does not make another admin the owner", async () => {
    const { req } = makeReq(asUser("user_other"), [owner, other])
    ;(req as unknown as { body: unknown }).body = {
      reviewer: { user_id: "user_owner", email: "owner@example.com", name: "Ada Okafor" },
      reviewed_by_user_id: "user_owner",
      reviewer_email: "owner@example.com",
      email: "owner@example.com",
    }
    expect(await resolveReviewer(req)).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
  })

  it("records no name rather than an email when the admin user has no name", async () => {
    const { req } = makeReq(asUser("user_owner"), [{ id: "user_owner", email: "owner@example.com", first_name: " ", last_name: null }])
    expect(await resolveReviewer(req)).toMatchObject({ ok: true, reviewer: { user_id: "user_owner", name: null } })
  })
})
