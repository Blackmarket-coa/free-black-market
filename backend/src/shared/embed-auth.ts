/**
 * Shared helpers for connect.js embed authentication.
 *
 * The embed-key middleware and the embed routes both need to (a) pull the
 * publishable key out of the Authorization header and (b) decide whether a
 * request Origin is allowed by a vendor's `connect_domains` allow-list. Keeping
 * the logic here ensures the middleware and any handler agree.
 */

/**
 * Extract a `pk_live_…` publishable key from an Authorization header.
 *
 * Accepts both `PublishableKey pk_live_…` (canonical connect.js form) and a
 * bare `pk_live_…` value. Returns null when absent or malformed.
 */
export function extractEmbedKey(
  authorization: string | undefined | null
): string | null {
  if (!authorization || typeof authorization !== "string") return null
  const trimmed = authorization.trim()
  const match = trimmed.match(/^(?:PublishableKey\s+)?(pk_live_[A-Za-z0-9_-]+)$/)
  return match ? match[1] : null
}

/** Reduce an Origin/Referer value to a bare, lowercased hostname (no www, no port). */
export function originHostname(origin: string | undefined | null): string | null {
  if (!origin || typeof origin !== "string") return null
  try {
    // Origin is normally a full URL ("https://shop.example.com"); Referer too.
    const url = new URL(origin)
    return url.hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    // Fall back to treating it as a bare host.
    const host = origin.trim().toLowerCase().replace(/^[a-z]+:\/\//, "")
    return host.split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "") || null
  }
}

/**
 * True when `origin` is permitted by the vendor's `connect_domains` allow-list.
 *
 * `connect_domains` holds bare hostnames (possibly with a port) as produced by
 * normalizeDomains(); we compare against the host with the port stripped so a
 * vendor doesn't have to enumerate ports.
 */
export function originAllowed(
  origin: string | undefined | null,
  domains: unknown
): boolean {
  const host = originHostname(origin)
  if (!host) return false
  if (!Array.isArray(domains)) return false
  for (const raw of domains) {
    if (typeof raw !== "string") continue
    const allowed = raw.trim().toLowerCase().split(":")[0].replace(/^www\./, "")
    if (allowed && allowed === host) return true
  }
  return false
}
