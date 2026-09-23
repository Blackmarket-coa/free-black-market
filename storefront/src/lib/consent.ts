/**
 * Cookie-consent state for the storefront (PRE_LAUNCH_AUDIT LEG-8).
 *
 * The visitor's choice lives in exactly one place: the `fbm_consent` cookie.
 * No localStorage, no server-side record — a cookie is the only store that
 * the middleware, server components, server actions and browser code can
 * all read the same way, and it is what lets the root layout render the
 * banner's initial state without a flash on the client.
 *
 * Two values only. `accepted` unlocks the non-essential trackers (creator
 * attribution cookies, analytics dispatch). `essential` records that the
 * visitor was asked and declined, so the banner stays hidden. Absence means
 * the visitor has not chosen yet, and every non-essential tracker treats
 * that as a "no".
 *
 * This module must stay importable from the Edge middleware, from client
 * components and from `"use server"` modules, so it imports nothing from
 * `next/*` — callers hand it whichever cookie source they have.
 */

export const CONSENT_COOKIE = "fbm_consent"

/** 180 days, per the audit follow-up. */
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

/**
 * Window event dispatched when the visitor asks to revisit their choice
 * ("Cookie settings" in the footer). The banner listens for it and re-shows.
 */
export const CONSENT_RESET_EVENT = "fbm:consent-reset"

export type ConsentChoice = "accepted" | "essential"

/**
 * Anything that can yield the raw cookie value:
 *  - a raw `Cookie` header / `document.cookie` string,
 *  - a Next `RequestCookies` / `ReadonlyRequestCookies` store (`get(name)`
 *    returning `{ value }`), or a plain `Map`-like `get(name)` returning the
 *    string itself.
 */
export type ConsentCookieSource =
  | string
  | null
  | undefined
  | {
      get(name: string): { value: string } | string | undefined | null
    }

const CHOICES: ReadonlySet<string> = new Set<ConsentChoice>([
  "accepted",
  "essential",
])

export function parseConsent(
  value: string | null | undefined
): ConsentChoice | null {
  if (!value) return null
  const trimmed = value.trim()
  return CHOICES.has(trimmed) ? (trimmed as ConsentChoice) : null
}

function readCookieFromString(
  cookieString: string,
  name: string
): string | null {
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    const raw = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

function readCookieValue(source: ConsentCookieSource): string | null {
  if (source == null) return null
  if (typeof source === "string") {
    return readCookieFromString(source, CONSENT_COOKIE)
  }
  const entry = source.get(CONSENT_COOKIE)
  if (entry == null) return null
  return typeof entry === "string" ? entry : (entry.value ?? null)
}

/**
 * Read the stored choice. Pass the cookie source you have on the server
 * (`request.cookies` in middleware, `await cookies()` in a server component
 * or action); omit it in the browser to read `document.cookie`.
 */
export function readConsent(
  source?: ConsentCookieSource
): ConsentChoice | null {
  if (source === undefined) {
    if (typeof document === "undefined") return null
    return parseConsent(readCookieFromString(document.cookie, CONSENT_COOKIE))
  }
  return parseConsent(readCookieValue(source))
}

/** True only when the visitor explicitly accepted non-essential cookies. */
export function hasTrackingConsent(source?: ConsentCookieSource): boolean {
  return readConsent(source) === "accepted"
}

/**
 * Serialize the choice as a `Set-Cookie` / `document.cookie` string.
 * Not `HttpOnly` on purpose: the browser has to read it back to decide
 * whether to dispatch analytics.
 */
export function serializeConsent(
  choice: ConsentChoice,
  options: { secure?: boolean; maxAge?: number } = {}
): string {
  const maxAge = options.maxAge ?? CONSENT_MAX_AGE_SECONDS
  const parts = [
    `${CONSENT_COOKIE}=${choice}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "SameSite=Lax",
  ]
  if (options.secure) parts.push("Secure")
  return parts.join("; ")
}

/** Expired serialization used to forget the choice. */
export function serializeConsentRemoval(
  options: { secure?: boolean } = {}
): string {
  const parts = [`${CONSENT_COOKIE}=`, "Max-Age=0", "Path=/", "SameSite=Lax"]
  if (options.secure) parts.push("Secure")
  return parts.join("; ")
}

function isSecurePage(): boolean {
  return typeof location !== "undefined" && location.protocol === "https:"
}

/** Browser only: persist the visitor's choice. No-op on the server. */
export function setConsent(choice: ConsentChoice): void {
  if (typeof document === "undefined") return
  document.cookie = serializeConsent(choice, { secure: isSecurePage() })
}

/** Browser only: forget the choice so the banner asks again. */
export function clearConsent(): void {
  if (typeof document === "undefined") return
  document.cookie = serializeConsentRemoval({ secure: isSecurePage() })
}
