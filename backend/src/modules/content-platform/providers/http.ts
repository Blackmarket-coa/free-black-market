/**
 * Shared HTTP + normalization helpers for the content-platform OAuth adapters.
 * Centralizes the fetch + error-mapping dance so TikTok / Instagram / YouTube /
 * Twitch don't each reimplement it. Uses the global `fetch` (Node 20+).
 */
import type { ProviderMetrics } from "./types"

/** Raised when an external platform API returns a non-2xx response. */
export class ProviderHttpError extends Error {
  constructor(
    public readonly platform: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(`${platform} API error ${status}: ${body.slice(0, 300)}`)
    this.name = "ProviderHttpError"
  }
}

async function requestJson(
  platform: string,
  url: string,
  init: RequestInit
): Promise<any> {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) {
    throw new ProviderHttpError(platform, res.status, text)
  }
  return text ? JSON.parse(text) : {}
}

/** POST an `application/x-www-form-urlencoded` body (OAuth token endpoints). */
export async function postForm(
  platform: string,
  url: string,
  form: Record<string, string>,
  headers: Record<string, string> = {}
): Promise<any> {
  return requestJson(platform, url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form).toString(),
  })
}

/** POST a JSON body (e.g. TikTok's video query API). */
export async function postJson(
  platform: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<any> {
  return requestJson(platform, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

/** GET JSON with optional query params + headers. */
export async function getJson(
  platform: string,
  url: string,
  opts: {
    headers?: Record<string, string>
    query?: Record<string, string | number | boolean | undefined>
  } = {}
): Promise<any> {
  const u = new URL(url)
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) {
      u.searchParams.set(key, String(value))
    }
  }
  return requestJson(platform, u.toString(), { headers: opts.headers })
}

/** Bearer auth header helper. */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

/** Convert a token endpoint's `expires_in` (seconds) to an absolute Date. */
export function expiresAtFromSeconds(
  expiresIn: number | string | undefined,
  now: number = Date.now()
): Date | undefined {
  const seconds = Number(expiresIn)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined
  }
  return new Date(now + seconds * 1000)
}

/** Coerce a possibly-string count to a finite non-negative integer. */
export function toCount(value: unknown): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Build a `ProviderMetrics` from platform-specific counts, defaulting missing
 * signals to 0 and stashing the raw payload. `qualified_views` defaults to the
 * raw view count when the platform exposes no deduped figure.
 */
export function toMetrics(args: {
  views?: unknown
  likes?: unknown
  shares?: unknown
  comments?: unknown
  saves?: unknown
  watch_time_seconds?: unknown
  qualified_views?: unknown
  raw: Record<string, unknown>
}): ProviderMetrics {
  const views = toCount(args.views)
  return {
    views,
    likes: toCount(args.likes),
    shares: toCount(args.shares),
    comments: toCount(args.comments),
    saves: args.saves === undefined ? undefined : toCount(args.saves),
    watch_time_seconds:
      args.watch_time_seconds === undefined
        ? undefined
        : toCount(args.watch_time_seconds),
    qualified_views:
      args.qualified_views === undefined ? views : toCount(args.qualified_views),
    raw: args.raw,
  }
}

/** Read the (currently plaintext) bearer token off a normalized account. */
export function accountToken(account: {
  access_token_encrypted: string | null
}): string {
  const token = account.access_token_encrypted
  if (!token) {
    throw new Error("Platform account has no access token")
  }
  return token
}
