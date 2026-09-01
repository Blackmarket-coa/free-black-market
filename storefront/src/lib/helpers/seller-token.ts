/**
 * Pure helpers for the in-app seller session.
 *
 * Kept free of `next/headers` and fetch so they can be unit-tested — the
 * cookie and network sides live in `lib/data/vendor-auth.ts`.
 */

export type SellerTokenClaims = {
  seller_id: string | null
  actor_type: string | null
  /** Expiry as epoch milliseconds, or null when the token carries none. */
  expires_at: number | null
}

/**
 * Decode a compact JWS payload without verifying it.
 *
 * Verification is the backend's job — every seller call is authorized
 * server-side against the real signature. We decode only to read
 * `app_metadata.seller_id` for display and `exp` for refresh scheduling,
 * so a forged token buys nothing: it would still fail at the API.
 */
export function decodeJwtPayload(
  token: string | null | undefined
): Record<string, unknown> | null {
  if (!token) return null
  try {
    const payload = token.split(".")[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
    return decoded && typeof decoded === "object" ? decoded : null
  } catch {
    return null
  }
}

/** Extract the claims the vendor surface cares about. */
export function readSellerClaims(
  token: string | null | undefined
): SellerTokenClaims | null {
  const payload = decodeJwtPayload(token)
  if (!payload) return null

  const appMetadata = (payload.app_metadata ?? {}) as Record<string, unknown>
  const sellerId =
    typeof appMetadata.seller_id === "string" ? appMetadata.seller_id : null
  const actorType =
    typeof payload.actor_type === "string" ? payload.actor_type : null
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null

  return { seller_id: sellerId, actor_type: actorType, expires_at: exp }
}

/** True when the token is absent, malformed, or past its expiry. */
export function isTokenExpired(
  token: string | null | undefined,
  now: number
): boolean {
  const claims = readSellerClaims(token)
  if (!claims) return true
  if (claims.expires_at === null) return false
  return now >= claims.expires_at
}

/**
 * Medusa issues seller JWTs with a 1-day lifetime and nothing renews them,
 * so a push-driven "tap the notification, ship the order" flow would log
 * the vendor out every 24h. We refresh well before expiry — but only while
 * the token is still valid, since /auth/token/refresh requires a live
 * bearer.
 */
export const SELLER_TOKEN_REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000

export function shouldRefreshToken(
  token: string | null | undefined,
  now: number
): boolean {
  const claims = readSellerClaims(token)
  if (!claims) return false
  if (claims.expires_at === null) return false
  if (now >= claims.expires_at) return false // already dead: re-login, not refresh
  return claims.expires_at - now <= SELLER_TOKEN_REFRESH_WINDOW_MS
}
