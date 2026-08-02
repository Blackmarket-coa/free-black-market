/**
 * Classification for failures of the `/auth/seller/session` fetch.
 *
 * A 401 means the token itself is bad (expired, invalid signature) — the only
 * fix is a fresh login, so the caller should clear the stored token and send
 * the user to `/login` once. Anything else (404 seller-profile-missing, 5xx,
 * network failure) cannot be fixed by re-entering credentials; bouncing to
 * `/login` for those is what produced the "log in → sent back to log in"
 * loop, so the caller should render an actionable error screen instead.
 */
export type SessionFetchError = Error & { status?: number }

export type SessionErrorKind = "reauthenticate" | "unavailable"

export const classifySessionError = (
  error: SessionFetchError | null | undefined
): SessionErrorKind | null => {
  if (!error) {
    return null
  }

  return error.status === 401 ? "reauthenticate" : "unavailable"
}
