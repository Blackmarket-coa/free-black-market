import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto"

/**
 * Blackout subscription manage sessions (operator answer 2026-10-06, item 21;
 * docs/contracts/blackout-integration.md, "Blackout subscription
 * self-service"). The pure parts: token, CSRF nonce, origins, ownership.
 *
 * Why not a JWT like the hosted checkout: JWT_SECRET is also Medusa's
 * http.jwtSecret, so a token signed with it is one claim away from a /store
 * customer session; and a JWT cannot be revoked. An opaque random token whose
 * sha256 is the only thing stored can be revoked (a re-mint does), cannot be
 * forged, and a read of the table cannot be replayed as a link.
 */

/** Absolute lifetime of a manage session: 15 minutes, never extended. */
export const MANAGE_SESSION_TTL_SECONDS = 15 * 60

/** The path the page and its actions live under (the token is the next segment). */
export const MANAGE_SESSIONS_PATH = "/v1/integrations/blackout/commerce/subscriptions/manage-sessions"

const CSRF_CONTEXT = "fbm-blackout-manage-csrf/v1"

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** A fresh opaque token: 32 random bytes, base64url (43 characters). */
export function newManageToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * The CSRF nonce of the session a token opens: an HMAC keyed by the token, so
 * it is bound to that one session, can be rendered on every GET without a
 * write, and reveals nothing about the token. Only its sha256 is stored.
 */
export function csrfNonceFor(token: string): string {
  return createHmac("sha256", token).update(CSRF_CONTEXT, "utf8").digest("base64url")
}

/** Constant-time comparison of two hex digests of equal length. */
function hexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Whether a submitted nonce is the session's own. */
export function csrfNonceMatches(storedHash: string, submitted: unknown): boolean {
  if (typeof submitted !== "string" || submitted.length === 0 || submitted.length > 128) {
    return false
  }
  return hexEqual(storedHash, sha256Hex(submitted))
}

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

function originOf(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * The accepted `return_url`, or null. Accepted only when its origin is one of
 * `BLACKOUT_RETURN_ORIGINS` (comma-separated); anything else is ignored, not
 * refused (contract). An unset allowlist accepts nothing.
 */
export function acceptedReturnUrl(
  returnUrl: string | undefined,
  allowlist: string | undefined = process.env.BLACKOUT_RETURN_ORIGINS
): string | null {
  if (!returnUrl || !allowlist) return null
  const origin = originOf(returnUrl)
  if (!origin) return null
  const allowed = allowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(originOf)
    .filter((o): o is string => o !== null)
  return allowed.includes(origin) ? returnUrl : null
}

/** FBM's own public origin (FREEBLACKMARKET_BASE_URL, else BACKEND_URL), or null. */
export function fbmOwnOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env.FREEBLACKMARKET_BASE_URL || env.BACKEND_URL
  return base ? originOf(base) : null
}

type RequestHeaders = Record<string, string | string[] | undefined>

function singleHeader(headers: RequestHeaders | undefined, name: string): string | undefined {
  const raw = headers?.[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === "string" ? value : undefined
}

/**
 * Whether an action POST came from the page's own script.
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be set by script or by
 * another site; only `same-origin` passes. A browser that sends no Fetch
 * Metadata must send an `Origin` equal to FBM's own public origin. Neither →
 * refused. Stricter than `navigatedFromOwnPage` (blackout-checkout.ts), which
 * falls back to the Referer: here a Referer is never enough.
 */
export function actionFromOwnPage(
  headers: RequestHeaders | undefined,
  ownOrigin: string | null = fbmOwnOrigin()
): boolean {
  const site = singleHeader(headers, "sec-fetch-site")
  if (site !== undefined) return site === "same-origin"
  const origin = singleHeader(headers, "origin")
  return !!origin && !!ownOrigin && origin === ownOrigin
}

/**
 * Whether the POST is JSON. A cross-origin `fetch` with this content type
 * needs a CORS preflight, and an HTML form cannot send it at all.
 */
export function isJsonRequest(headers: RequestHeaders | undefined): boolean {
  const type = singleHeader(headers, "content-type")
  if (!type) return false
  return type.split(";")[0].trim().toLowerCase() === "application/json"
}

// ---------------------------------------------------------------------------
// Session + ownership
// ---------------------------------------------------------------------------

export type ManageSessionRow = {
  id: string
  blackout_user_id: string
  customer_id: string | null
  token_hash: string
  csrf_nonce_hash: string
  expires_at: Date | string
  revoked_at: Date | string | null
  return_url: string | null
}

/** A session row that may still be used: not revoked and not expired. */
export function isLiveManageSession(row: ManageSessionRow, now: Date = new Date()): boolean {
  if (row.revoked_at !== null && row.revoked_at !== undefined) return false
  const expiresAt = new Date(row.expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt > now.getTime()
}

type OwnableSubscription = {
  customer_id?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Whether a manage session may see or act on a subscription. Checked for
 * every listed row and again for every action. Owned ONLY when both hold:
 *
 *   - the session is bound to a customer, and the row is that customer's;
 *   - the row carries `metadata.blackout_user_id` naming THIS session's
 *     member. The Blackout hosted checkout writes that stamp right after it
 *     creates each subscription (checkout `…/sessions/[token]/page`, the
 *     `updateSubscriptions` after `createSubscriptionWorkflow`); a row
 *     without it (bought on the storefront, or a checkout whose stamp write
 *     failed — that write only logs) is never listed or actionable here. The
 *     page manages Blackout-bought rows only (operator scope decision
 *     2026-10-06).
 *
 * Both halves are needed: a customer later re-stamped with another Blackout
 * id does not hand the earlier buyer's subscriptions — or the customer's
 * storefront purchases — to the member it now names.
 */
export function ownedByManageSession(
  sub: OwnableSubscription,
  session: Pick<ManageSessionRow, "customer_id" | "blackout_user_id">
): boolean {
  if (!session.customer_id || !session.blackout_user_id) return false
  if (sub.customer_id !== session.customer_id) return false
  return sub.metadata?.blackout_user_id === session.blackout_user_id
}
