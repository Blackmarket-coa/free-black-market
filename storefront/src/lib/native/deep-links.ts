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

/**
 * Prefix a same-origin path with the locale the app is currently on.
 *
 * Push payloads and deep links carry locale-less paths (`/vendor/orders/x`)
 * because the backend emitting them has no idea which storefront locale the
 * device is browsing. The locale middleware normally 307s those to
 * `/us/vendor/orders/x` — but it fail-softs when the region map can't be
 * loaded, and then `/vendor/orders/x` resolves `[locale]` to "vendor" and
 * 404s. That turns a degraded backend into a broken notification tap, so we
 * prefix client-side instead of relying on the redirect.
 *
 * A path that already carries a locale is left alone. Locales here are the
 * two-letter country codes the region map produces ("us", "pl"), which no
 * top-level route collides with.
 */
export function withLocalePrefix(
  path: string,
  currentPathname: string | null | undefined
): string {
  if (!path.startsWith("/")) return path

  const firstSegment = path.split("/")[1] ?? ""
  if (/^[a-z]{2}$/i.test(firstSegment)) return path

  const currentLocale = (currentPathname ?? "").split("/")[1] ?? ""
  if (!/^[a-z]{2}$/i.test(currentLocale)) return path

  return `/${currentLocale}${path}`
}
