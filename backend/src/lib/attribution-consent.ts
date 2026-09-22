/**
 * The storefront's cookie-consent choice, as the backend sees it.
 *
 * The storefront writes `fbm_consent=accepted|essential` (storefront
 * src/lib/consent.ts). The affiliate redirector runs on whichever host serves
 * `/r/:shortCode`: when that is the storefront's own host (a rewrite) the
 * cookie arrives and is honoured; when it is a separate API host the cookie is
 * simply absent. Absent means "no consent" — the safe reading, never the
 * permissive one — so a deployment that cannot see the choice sets no tracking
 * cookies and stores no identifiers.
 */
export const CONSENT_COOKIE = "fbm_consent"

export type ConsentChoice = "accepted" | "essential"

export function readConsentFromCookieHeader(
  header: string | undefined | null
): ConsentChoice | null {
  if (!header) return null
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== CONSENT_COOKIE) continue
    let value = part.slice(eq + 1).trim()
    try {
      value = decodeURIComponent(value)
    } catch {
      return null
    }
    return value === "accepted" || value === "essential" ? value : null
  }
  return null
}

/** True only when the visitor explicitly accepted tracking. */
export function trackingConsented(header: string | undefined | null): boolean {
  return readConsentFromCookieHeader(header) === "accepted"
}
