"use server"

import { fetchQuery } from "@/lib/config"
import { getAuthHeaders } from "@/lib/data/cookies"

/**
 * The storefront's transport for `/store/hawala/*`.
 *
 * The client hook (`lib/hooks/useHawalaWallet.ts`) used to call the backend
 * straight from the browser with `credentials: "include"`. That sent neither
 * header the store API needs: Medusa rejects any /store request without
 * `x-publishable-api-key`, and the customer's JWT lives in the httpOnly
 * `_medusa_jwt` cookie on the storefront's own origin, which page JS cannot
 * read and the backend never sees. So no wallet, investment or contribution
 * call carried the customer.
 *
 * This is the same shape as every other authenticated store call here: a
 * server action that sends the publishable key (via `fetchQuery`) and attaches
 * the cookie as a bearer when there is one. Signed out, the request goes
 * without a bearer — the backend's own 401 then speaks for the routes that
 * need a customer, and the guest-capable carried-pool contribution still works.
 *
 * It answers a result rather than throwing: Next masks a server action's
 * thrown message in production, and the hook needs the server's status, type
 * and message to show the right refusal.
 */

export type HawalaResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; type: string; message: string }

export type HawalaRequest = {
  /** A `/store/hawala/...` path, without a query string. */
  path: string
  method?: "GET" | "POST"
  query?: Record<string, string | number>
  body?: Record<string, unknown>
  /** Sent as `Idempotency-Key`; one per user-initiated money movement. */
  idempotencyKey?: string
}

// A server action is callable by any page on the origin, so it must not become
// a proxy that attaches the customer's bearer to arbitrary backend paths or
// verbs. Every check below runs at RUNTIME; the request's TypeScript type is no
// defence against a caller that ignores it.
//
// Path: `/store/hawala/` followed by one or more segments of `[A-Za-z0-9_-]`.
// No `%` (fetch's URL parser decodes `%2e%2e` to `..` and walks out of the
// prefix), no `.`, no empty segment, no query string. Ids are `pool_01...`
// style and never need escaping; one that did is refused rather than proxied.
const HAWALA_PATH = /^\/store\/hawala(?:\/[A-Za-z0-9_-]+)+$/
const HAWALA_PREFIX = "/store/hawala/"
const HAWALA_METHODS = new Set(["GET", "POST"])
const QUERY_KEY = /^[A-Za-z0-9_]+$/
// The hook sends a UUID or 32 hex chars, or "" (no header) when crypto is absent.
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{0,128}$/

function refused(): HawalaResult<never> {
  return {
    ok: false,
    status: 400,
    type: "invalid_request",
    message: "Unsupported hawala request",
  }
}

/** The request's path, re-checked after the same normalisation fetch applies. */
function safePath(path: unknown): string | null {
  if (typeof path !== "string" || !HAWALA_PATH.test(path)) return null
  // Belt and braces: whatever the regex admits must survive WHATWG URL
  // normalisation unchanged and still sit under the prefix.
  let normalised: string
  try {
    normalised = new URL(path, "http://hawala.invalid").pathname
  } catch {
    return null
  }
  return normalised === path && normalised.startsWith(HAWALA_PREFIX) ? path : null
}

/**
 * The query, with keys and values URI-encoded: `fetchQuery` concatenates them
 * into the URL raw, so an unencoded value could add parameters or a fragment.
 */
function safeQuery(query: unknown): Record<string, string> | null {
  if (query === undefined) return {}
  if (!query || typeof query !== "object" || Array.isArray(query)) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (!QUERY_KEY.test(key)) return null
    if (typeof value !== "string" && typeof value !== "number") return null
    out[key] = encodeURIComponent(String(value))
  }
  return out
}

export async function hawalaRequest<T>(
  request: HawalaRequest
): Promise<HawalaResult<T>> {
  const path = safePath(request?.path)
  const method = request?.method ?? "GET"
  const query = safeQuery(request?.query)
  const idempotencyKey = request?.idempotencyKey
  if (
    !path ||
    typeof method !== "string" ||
    !HAWALA_METHODS.has(method) ||
    !query ||
    (idempotencyKey !== undefined &&
      (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)))
  ) {
    return refused()
  }

  const headers: Record<string, string> = { ...((await getAuthHeaders()) ?? {}) }
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey
  }

  try {
    const res = await fetchQuery(path, {
      method,
      query,
      headers,
      body: request.body,
    })

    if (res.ok) {
      return { ok: true, data: res.data as T }
    }

    return {
      ok: false,
      status: res.status,
      type: typeof res.error?.type === "string" ? res.error.type : "request_failed",
      // `message` when the handler sent one; else a legacy `{ error: "..." }`.
      message:
        typeof res.error?.message === "string"
          ? res.error.message
          : typeof res.error?.legacyError === "string"
            ? res.error.legacyError
            : "Request failed",
    }
  } catch {
    return {
      ok: false,
      status: 503,
      type: "network_error",
      message: "Could not reach the server. Please try again.",
    }
  }
}
