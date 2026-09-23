/**
 * Resolve the HMAC secret that signs the `/r/:shortCode` visitor and
 * affiliate cookies.
 *
 * Order: STOREFRONT_VISITOR_SIGNING_KEY, then JWT_SECRET, then `null`. There
 * is deliberately no literal fallback — a publicly known signing key lets
 * anyone forge the visitor cookie — so a `null` result means "sign nothing",
 * never "use a default". Blank and whitespace-only values count as unset.
 */
export function resolveAttributionCookieSecret(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  for (const candidate of [env.STOREFRONT_VISITOR_SIGNING_KEY, env.JWT_SECRET]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate
    }
  }
  return null
}
