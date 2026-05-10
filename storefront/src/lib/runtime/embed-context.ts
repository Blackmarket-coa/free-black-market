/**
 * Capacitor / in-app webview embed-context detector for the FBM
 * storefront per AGGRESSIVE_OPERATIONS_GUIDE.md §2.8 and §5.1.
 *
 * The Blackout Capacitor wrapper signals embedded rendering by setting
 * the `X-FBM-Embed-Origin` request header. When present and the origin
 * is in the configured allowlist, the storefront swaps strict-origin
 * cookies / iframe defaults for delegated-auth-friendly equivalents.
 *
 * Pure helpers here so middleware, server components, and the bootstrap
 * endpoint can all share the same logic.
 */

const EMBED_ORIGIN_HEADER = "x-fbm-embed-origin"

export type EmbedContext = {
  isEmbedded: boolean
  origin: string | null
  isAllowedOrigin: boolean
}

export function getAllowedEmbedOrigins(): string[] {
  const raw = process.env.BLACKOUT_EMBED_ALLOWED_ORIGINS ?? ""
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
}

/**
 * Detect embed context from a Headers-like input (Next.js request
 * headers, fetch Headers, or a plain object). Origin allowlist is
 * compared case-insensitively.
 */
export function detectEmbedContext(headers: {
  get: (name: string) => string | null
}): EmbedContext {
  const origin = headers.get(EMBED_ORIGIN_HEADER)
  if (!origin) {
    return { isEmbedded: false, origin: null, isAllowedOrigin: false }
  }
  const allowed = getAllowedEmbedOrigins().map((o) => o.toLowerCase())
  const isAllowed = allowed.includes(origin.toLowerCase())
  return { isEmbedded: true, origin, isAllowedOrigin: isAllowed }
}

export const EMBED_HEADER_NAME = EMBED_ORIGIN_HEADER
