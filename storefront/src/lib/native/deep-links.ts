/**
 * Deep-link and path-sanitization helpers for the native shell.
 * Pure functions, no node builtins — importable from client bundles and
 * route handlers alike.
 */

export const NATIVE_DEEP_LINK_SCHEME = "fbm"

/**
 * Constrain a caller-supplied redirect to a same-origin absolute path so
 * neither the handoff route nor the deep-link router can be used as an
 * open redirector. Returns the fallback for anything else — "//host" and
 * "/\host" are scheme-relative URLs in browsers, and embedded
 * backslashes/whitespace get normalised unpredictably, so they are all
 * rejected.
 */
export function sanitizeRedirectPath(
  redirect: string | null | undefined,
  fallback = "/"
): string {
  if (!redirect) return fallback
  if (!redirect.startsWith("/")) return fallback
  if (redirect.startsWith("//")) return fallback
  if (/[\\\s]/.test(redirect)) return fallback
  return redirect
}

/**
 * Map an `fbm://` deep link to a storefront path.
 *
 *   fbm://open?path=/us/products/basil   → /us/products/basil
 *   fbm://products/basil                 → /products/basil
 *   fbm://cart                           → /cart
 *
 * Locale-less paths are fine — the locale middleware 307s them to the
 * visitor's region. Returns null for other schemes or unusable URLs so
 * the caller can ignore the event.
 */
export function deepLinkToPath(url: string | null | undefined): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${NATIVE_DEEP_LINK_SCHEME}:`) return null

  const explicitPath = parsed.searchParams.get("path")
  if (explicitPath) {
    const sanitized = sanitizeRedirectPath(explicitPath, "")
    return sanitized || null
  }

  const joined = `/${parsed.host}${parsed.pathname}`.replace(/\/+$/, "") || "/"
  const sanitized = sanitizeRedirectPath(joined, "")
  if (!sanitized || sanitized === "/open") return null
  return `${sanitized}${parsed.search}`
}
