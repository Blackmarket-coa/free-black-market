import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * Who may sign off a jurisdiction rule.
 *
 * A sign-off is the one step in the rule store that turns a draft into text
 * shown as reviewed, so it is not open to every admin. The operator names the
 * reviewers in the environment:
 *
 *   JURISDICTION_RULE_REVIEWER_EMAILS=owner@example.com,second@example.com
 *
 * **Unset or empty means nobody can review.** There is no default reviewer and
 * no fallback to "any admin": a deployment that forgot the variable must fail
 * closed, not open.
 *
 * The reviewer is always the authenticated admin user. Nothing here, and
 * nothing in the route that calls it, reads a name, an id or an email from
 * the request body (`admin/wholesale-application/[id]/approve` takes
 * `reviewed_by` from its body; that is the pattern not to copy).
 *
 * The match is exact, including letter case, against the email stored on the
 * admin user. That is deliberate. Medusa keeps admin emails unique as exact
 * strings, and anyone who can send an invite can accept it under any email
 * not already taken (`acceptInviteWorkflow` prefers the email in the request
 * over the invite's). So a comparison that ignored case, or trimmed the
 * stored email, would let another admin create `Owner@Example.com` beside
 * `owner@example.com` and pass as the reviewer. An exact match cannot be
 * squatted that way while the reviewer's own user exists. The cost is that a
 * list entry typed in a different case matches no one; the refusal says so.
 */
export const REVIEWER_ALLOWLIST_ENV = "JURISDICTION_RULE_REVIEWER_EMAILS"

/** The configured reviewer emails. Entries are separated by commas, semicolons or whitespace. */
export function reviewerAllowlist(raw: string | undefined = process.env[REVIEWER_ALLOWLIST_ENV]): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** Whether this exact stored email is on the list. An empty list admits no one. */
export function onReviewerAllowlist(email: unknown, raw: string | undefined = process.env[REVIEWER_ALLOWLIST_ENV]): boolean {
  if (typeof email !== "string" || email.length === 0) return false
  return reviewerAllowlist(raw).includes(email)
}

export type Reviewer = { user_id: string; name: string | null; email: string }

export type ReviewerResolution =
  | { ok: true; reviewer: Reviewer }
  | { ok: false; status: 401 | 403; type: "unauthorized" | "not_a_reviewer"; message: string }

type AuthContext = { actor_id?: unknown; actor_type?: unknown }
type AdminUser = { id: string; email?: string | null; first_name?: string | null; last_name?: string | null }
type UserModule = { retrieveUser(id: string): Promise<AdminUser> }

/** The admin user behind this request, or null for anything else (an API key, a seller, nobody). */
export function adminUserIdOf(req: MedusaRequest): string | null {
  const context = (req as MedusaRequest & { auth_context?: AuthContext }).auth_context
  if (!context || context.actor_type !== "user") return null
  return typeof context.actor_id === "string" && context.actor_id.length > 0 ? context.actor_id : null
}

/**
 * The reviewer for this request: the authenticated admin user, looked up in
 * the user module, if and only if their stored email is on the allowlist.
 */
export async function resolveReviewer(req: MedusaRequest): Promise<ReviewerResolution> {
  const userId = adminUserIdOf(req)
  if (!userId) {
    return {
      ok: false,
      status: 403,
      type: "not_a_reviewer",
      message: "A rule is signed off from an admin user's own login. An API key cannot review.",
    }
  }

  if (reviewerAllowlist().length === 0) {
    return {
      ok: false,
      status: 403,
      type: "not_a_reviewer",
      message: `No reviewer is configured, so nobody can review: ${REVIEWER_ALLOWLIST_ENV} is not set on this deployment.`,
    }
  }

  let user: AdminUser | null = null
  try {
    user = await req.scope.resolve<UserModule>(Modules.USER).retrieveUser(userId)
  } catch {
    user = null
  }

  if (!user || !onReviewerAllowlist(user.email)) {
    return {
      ok: false,
      status: 403,
      type: "not_a_reviewer",
      message: `Your admin login is not on the reviewer list (${REVIEWER_ALLOWLIST_ENV}). The list is matched exactly, including letter case, against the email on your admin user.`,
    }
  }

  const name = [user.first_name, user.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim())
    .join(" ")

  return { ok: true, reviewer: { user_id: user.id, name: name.length > 0 ? name : null, email: user.email as string } }
}
