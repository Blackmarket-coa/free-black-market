import { fetchQuery, getAuthToken, setAuthToken } from "./client"

/**
 * The token sign-up stores names no actor: the login has no store yet
 * (hooks/api/auth.tsx, `useSignUpWithEmailPass`). Approval links the login to
 * a store, but a token minted before it still names none, and Mercur's vendor
 * gate reads the actor off the token: every `/vendor/*` call answers 403
 * "Seller is not active" while `/auth/seller/session` says approved, and
 * `fetchQuery` drops a token only on a 401. `POST /auth/token/refresh` with
 * that token returns one that names the store (SD-151 (4), measured).
 */

/** The payload of a JWT, or null when the token is not one this can read. */
export const readTokenPayload = (
  token: string
): Record<string, unknown> | null => {
  const part = token.split(".")[1]
  if (!part) {
    return null
  }
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    const payload: unknown = JSON.parse(globalThis.atob(padded))
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Whether a token names an actor: "actor" when it does, "none" when it is a
 * readable JWT that names none, "unreadable" when it cannot be read (left
 * alone: nothing here can say what it is).
 */
export const tokenActor = (token: string): "actor" | "none" | "unreadable" => {
  const payload = readTokenPayload(token)
  if (!payload) {
    return "unreadable"
  }
  const actor = payload.actor_id
  return typeof actor === "string" && actor.trim() !== "" ? "actor" : "none"
}

/** Shown on the login page when the stored token could not be upgraded. */
export const APPROVED_SIGN_IN_AGAIN =
  "Your store has been approved. This browser was still signed in from before the approval and could not be updated, so please sign in again to open your store."

/**
 * The error the session hooks raise when the backend refused the refresh: a
 * 401, or an answer whose token still names no store. Only a fresh sign-in
 * gives this browser a token that works.
 */
export class TokenRefreshFailed extends Error {
  /** Read by `classifySessionError`: the fix is a fresh sign-in. */
  status = 401
  constructor() {
    super(APPROVED_SIGN_IN_AGAIN)
    this.name = "TokenRefreshFailed"
  }
}

export const isTokenRefreshFailure = (
  error: unknown
): error is TokenRefreshFailed => error instanceof TokenRefreshFailed

/**
 * The refresh did not get an answer that says anything about the token: a
 * 429, a 5xx, a network error. Signing in again would not help: `POST
 * /auth/token/refresh` shares the 20-a-minute `POST /auth/*` limiter with the
 * sign-in itself (measured: both answered 429 together), and a backend that
 * answers 5xx to one answers it to the other. So this is not a 401: the pages
 * show it with a way to try again, and the token is asked about again then.
 */
export class TokenRefreshUnavailable extends Error {
  constructor(
    /** The refresh's HTTP status, or undefined when no answer came. */
    public status: number | undefined,
    reason: string
  ) {
    super(
      `Your store has been approved, but this browser could not be updated just now (${reason}). Try again in a moment.`
    )
    this.name = "TokenRefreshUnavailable"
  }
}

export const isTokenRefreshUnavailable = (
  error: unknown
): error is TokenRefreshUnavailable => error instanceof TokenRefreshUnavailable

/** The stored token is a readable JWT that names no store: a refresh is due. */
export const storedTokenNeedsRefresh = () => {
  const token = getAuthToken()
  return token !== "" && tokenActor(token) === "none"
}

export type ActorTokenOutcome = "ok" | "refreshed" | "sign_in_again"

/** What a failed `fetchQuery` says about the request. */
const statusOf = (error: unknown): number | undefined => {
  const status = (error as { details?: { status?: unknown } } | null)?.details
    ?.status
  return typeof status === "number" ? status : undefined
}
const reasonOf = (error: unknown, status: number | undefined): string => {
  const said = (error as { details?: { backendMessage?: unknown } } | null)
    ?.details?.backendMessage
  if (typeof said === "string" && said.trim() !== "") {
    return status ? `${status}: ${said}` : said
  }
  if (status) return `the server answered ${status}`
  return "no answer from the server"
}

/** The refresh in flight, so that hooks asking at once share one request. */
let inFlight: { token: string; outcome: Promise<ActorTokenOutcome> } | null =
  null
/** The token whose one refresh named no actor: it is never tried again. */
let refused: string | null = null

/**
 * Whether the token now stored is the one whose refresh did not work. The
 * pages that sign the vendor out on `TokenRefreshFailed` ask this first: the
 * error stays on a cached query after the vendor has signed in again, and it
 * says nothing about the new token.
 */
export const storedTokenWasRefused = () => {
  const token = getAuthToken()
  return token !== "" && token === refused
}

/**
 * Call once the backend has said the login's store is approved. When the
 * stored token names no actor, refreshes it and stores the result only if that
 * names one.
 *
 * "sign_in_again" means the backend refused: a 401, or a 2xx whose token
 * names no actor. The caller signs the vendor out to the login page, and that
 * token is never sent to the refresh again. Any other failure (a 429, a 5xx,
 * no answer) rejects with `TokenRefreshUnavailable` and is not remembered, so
 * the next read asks again. Readers asking at once share one request.
 */
export const upgradeApprovedSellerToken = (): Promise<ActorTokenOutcome> => {
  const token = getAuthToken()
  if (!token || tokenActor(token) !== "none") {
    return Promise.resolve("ok")
  }
  if (refused === token) {
    return Promise.resolve("sign_in_again")
  }
  if (inFlight?.token === token) {
    return inFlight.outcome
  }

  const outcome = (async (): Promise<ActorTokenOutcome> => {
    let response: { token?: unknown } | null
    try {
      // `/auth/*` is exempt from the stored bearer in fetchQuery, so the token
      // being refreshed is named here; a 401 from an exempt route drops nothing.
      response = (await fetchQuery("/auth/token/refresh", {
        method: "POST",
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      })) as { token?: unknown } | null
    } catch (error) {
      const status = statusOf(error)
      if (status !== 401) {
        // Says nothing about the token: try again later.
        throw new TokenRefreshUnavailable(status, reasonOf(error, status))
      }
      // The backend refused the token (measured: an expired one answers 401).
      refused = token
      return "sign_in_again"
    }
    const next = response?.token
    if (typeof next === "string" && tokenActor(next) === "actor") {
      // A sign-in that finished meanwhile stored a newer token: keep it.
      if (getAuthToken() === token) {
        setAuthToken(next)
      }
      return "refreshed"
    }
    // Answered, and the token it gave names no store.
    refused = token
    return "sign_in_again"
  })().finally(() => {
    inFlight = null
  })

  inFlight = { token, outcome }
  return outcome
}
