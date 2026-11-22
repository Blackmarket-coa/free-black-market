import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  RETIRED_REVIEWER_EMAILS_ENV,
  REVIEWER_ALLOWLIST_ENV,
  adminUserIdOf,
  onReviewerAllowlist,
  resolveReviewer,
  reviewerAllowlist,
} from "../reviewers"

/**
 * The reviewer allowlist: who may turn a draft rule into reviewed text. Keyed
 * by admin user id, because an email can be registered again by another admin
 * once the owner's user is deleted (PL-2 review), and a user id cannot.
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

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe("reviewer allowlist", () => {
  const original = process.env[REVIEWER_ALLOWLIST_ENV]
  afterEach(() => restore(REVIEWER_ALLOWLIST_ENV, original))

  it("is read from JURISDICTION_RULE_REVIEWER_USER_IDS", () => {
    expect(REVIEWER_ALLOWLIST_ENV).toBe("JURISDICTION_RULE_REVIEWER_USER_IDS")
  })

  it("admits nobody when the variable is unset, empty or only separators", () => {
    for (const raw of [undefined, "", "   ", ",", " , ; \n"]) {
      expect(reviewerAllowlist(raw)).toEqual([])
      expect(onReviewerAllowlist("user_owner", raw)).toBe(false)
      expect(onReviewerAllowlist("", raw)).toBe(false)
    }
  })

  it("reads entries separated by commas, semicolons or whitespace", () => {
    expect(reviewerAllowlist("user_owner, user_second;user_third\nuser_fourth")).toEqual([
      "user_owner",
      "user_second",
      "user_third",
      "user_fourth",
    ])
  })

  it("matches the user id exactly", () => {
    const list = "user_owner,user_second"
    expect(onReviewerAllowlist("user_owner", list)).toBe(true)
    expect(onReviewerAllowlist("user_second", list)).toBe(true)
    for (const lookalike of ["user_third", "user_owner2", "xuser_owner", "USER_OWNER", " user_owner", "owner@example.com"]) {
      expect(onReviewerAllowlist(lookalike, list)).toBe(false)
    }
  })

  it("matches nothing that is not a non-empty string", () => {
    for (const id of [null, undefined, 42, {}, ["user_owner"]]) {
      expect(onReviewerAllowlist(id, "user_owner")).toBe(false)
    }
  })

  it("reads the environment at call time, not at import", () => {
    delete process.env[REVIEWER_ALLOWLIST_ENV]
    expect(onReviewerAllowlist("user_owner")).toBe(false)
    process.env[REVIEWER_ALLOWLIST_ENV] = "user_owner"
    expect(onReviewerAllowlist("user_owner")).toBe(true)
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
  const originalRetired = process.env[RETIRED_REVIEWER_EMAILS_ENV]
  beforeEach(() => {
    process.env[REVIEWER_ALLOWLIST_ENV] = "user_owner"
    delete process.env[RETIRED_REVIEWER_EMAILS_ENV]
  })
  afterEach(() => {
    restore(REVIEWER_ALLOWLIST_ENV, original)
    restore(RETIRED_REVIEWER_EMAILS_ENV, originalRetired)
  })

  const owner: User = { id: "user_owner", email: "owner@example.com", first_name: "Ada", last_name: "Okafor" }
  const other: User = { id: "user_other", email: "other@example.com", first_name: "Sam", last_name: "Reed" }

  it("resolves an allowlisted admin from the user module, by the authenticated actor id, with their email", async () => {
    const { req, retrieveUser } = makeReq(asUser("user_owner"), [owner, other])
    const result = await resolveReviewer(req)
    expect(result).toEqual({ ok: true, reviewer: { user_id: "user_owner", name: "Ada Okafor", email: "owner@example.com" } })
    expect(retrieveUser).toHaveBeenCalledWith("user_owner")
  })

  it("refuses an admin who is not on the list, with 403, without looking them up", async () => {
    const { req, retrieveUser } = makeReq(asUser("user_other"), [owner, other])
    expect(await resolveReviewer(req)).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
    expect(retrieveUser).not.toHaveBeenCalled()
  })

  it("refuses a different admin user who has the reviewer's email: the owner deleted and their address registered again", async () => {
    // What the PL-2 review measured on Postgres: another admin deletes the
    // owner's user (a soft delete) and accepts an invite under the owner's
    // email. The new user has the owner's email and name, and another id.
    const impostor: User = { id: "user_impostor", email: "owner@example.com", first_name: "Ada", last_name: "Okafor" }
    const { req } = makeReq(asUser("user_impostor"), [impostor])
    expect(await resolveReviewer(req)).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
    // And the deleted owner's own id, which the user module no longer returns, admits nobody.
    expect(await resolveReviewer(makeReq(asUser("user_owner"), [impostor]).req)).toMatchObject({ ok: false, status: 403 })
  })

  it("refuses everyone when the variable is unset, the listed owner included, without looking anyone up", async () => {
    delete process.env[REVIEWER_ALLOWLIST_ENV]
    const { req, retrieveUser } = makeReq(asUser("user_owner"), [owner])
    const result = await resolveReviewer(req)
    expect(result).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
    expect((result as { message: string }).message).toContain("JURISDICTION_RULE_REVIEWER_USER_IDS is not set")
    expect(retrieveUser).not.toHaveBeenCalled()
  })

  it("does not read the retired email list, and says so when only it is set", async () => {
    delete process.env[REVIEWER_ALLOWLIST_ENV]
    process.env[RETIRED_REVIEWER_EMAILS_ENV] = "owner@example.com"
    const result = await resolveReviewer(makeReq(asUser("user_owner"), [owner]).req)
    expect(result).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
    expect((result as { message: string }).message).toContain("JURISDICTION_RULE_REVIEWER_EMAILS is set but is no longer read")
  })

  it("refuses an API key, a seller and an unauthenticated request", async () => {
    for (const auth of [{ actor_id: "apk_1", actor_type: "api-key" }, { actor_id: "user_owner", actor_type: "seller" }, undefined]) {
      const { req, retrieveUser } = makeReq(auth, [owner])
      expect(await resolveReviewer(req)).toMatchObject({ ok: false, status: 403, type: "not_a_reviewer" })
      expect(retrieveUser).not.toHaveBeenCalled()
    }
  })

  it("refuses when the listed user cannot be found, or has no email to record", async () => {
    process.env[REVIEWER_ALLOWLIST_ENV] = "user_gone,user_blank"
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
    expect(await resolveReviewer(req)).toMatchObject({
      ok: true,
      reviewer: { user_id: "user_owner", name: null, email: "owner@example.com" },
    })
  })
})
