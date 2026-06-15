import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { parseCorsOrigins } from "@medusajs/framework/utils"

import { createLogger } from "./logger"

const log = createLogger("shared/csrf-guard")

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Marketplace hostnames that are always trusted, mirroring the hardcoded
 * subdomain allowlists in the admin/vendor CORS middlewares so this guard never
 * rejects an origin the CORS layer would accept.
 */
const ALWAYS_ALLOWED_HOSTNAMES = new Set([
  "freeblackmarket.com",
  "api.freeblackmarket.com",
  "admin.freeblackmarket.com",
  "vendor.freeblackmarket.com",
])

/**
 * Collect the configured origin allowlist from the same environment variables
 * the CORS layer reads (see `getVendorCorsOrigins` in `api/middlewares.ts`), so
 * the CSRF check and CORS agree on what counts as a first-party origin.
 */
function configuredOrigins(): Array<string | RegExp> {
  const origins = new Set<string>()

  for (const envVar of ["VENDOR_CORS", "STORE_CORS", "AUTH_CORS", "ADMIN_CORS"]) {
    for (const o of (process.env[envVar] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      origins.add(o)
    }
  }

  for (const envVar of [
    "VENDOR_PANEL_URL",
    "ADMIN_URL",
    "STOREFRONT_URL",
    "BACKEND_URL",
  ]) {
    const v = process.env[envVar]?.trim()
    if (v) {
      origins.add(v)
    }
  }

  return parseCorsOrigins(Array.from(origins).join(","))
}

/**
 * True when `origin` (an absolute origin string) is a trusted first-party
 * origin: a configured CORS origin, a known marketplace subdomain, or a Railway
 * preview deployment in non-production.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) {
    return false
  }

  let normalized: string
  let hostname: string
  try {
    const url = new URL(origin)
    normalized = url.origin
    hostname = url.hostname.toLowerCase()
  } catch {
    return false
  }

  if (ALWAYS_ALLOWED_HOSTNAMES.has(hostname)) {
    return true
  }

  // Railway preview deployments are allowed in non-production only (mirrors CORS).
  if (
    process.env.NODE_ENV !== "production" &&
    hostname.endsWith(".up.railway.app")
  ) {
    return true
  }

  const trimmed = normalized.replace(/\/$/, "")
  return configuredOrigins().some((entry) =>
    entry instanceof RegExp
      ? entry.test(normalized)
      : entry === normalized || entry === trimmed
  )
}

function originFromReferer(referer?: string): string | undefined {
  if (!referer) {
    return undefined
  }
  try {
    return new URL(referer).origin
  } catch {
    return undefined
  }
}

/**
 * CSRF guard for the cookie/session-authenticated surfaces.
 *
 * The admin-panel and vendor-panel authenticate with session cookies
 * (`@medusajs/js-sdk` `auth: { type: "session" }` + `credentials: "include"`);
 * the storefront uses bearer tokens and is unaffected. The `cors` package does
 * not stop a forged cross-site request from executing — it only withholds
 * response headers — so a CSRF POST riding a logged-in operator's session cookie
 * would still run. On state-changing methods we therefore require the request's
 * Origin (or Referer fallback) to be in the same allowlist CORS enforces.
 *
 * Exemptions:
 *  - Safe methods (GET/HEAD/OPTIONS) — no state change, and OPTIONS preflight
 *    must reach the CORS layer.
 *  - Requests carrying a bearer token and no cookie — a browser's ambient
 *    credentials cannot drive a bearer-only client, so these are not CSRF-able
 *    (server-to-server, mobile, API integrations).
 */
export function enforceSameOriginForCookieAuth(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  const method = (req.method || "GET").toUpperCase()
  if (SAFE_METHODS.has(method)) {
    next()
    return
  }

  const hasCookie = !!req.headers.cookie
  const hasBearer = (req.headers.authorization || "").startsWith("Bearer ")

  // Only cookie-bearing, non-bearer requests can be driven by ambient browser
  // credentials. Everything else is exempt from the origin check.
  if (!hasCookie || hasBearer) {
    next()
    return
  }

  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin : undefined
  const refererHeader =
    (typeof req.headers.referer === "string" && req.headers.referer) ||
    (typeof (req.headers as Record<string, unknown>).referrer === "string" &&
      ((req.headers as Record<string, string>).referrer)) ||
    undefined
  const candidate = origin || originFromReferer(refererHeader)

  if (candidate && isAllowedOrigin(candidate)) {
    next()
    return
  }

  log.warn(
    `[CSRF] Blocked ${method} ${req.path} — cookie-authenticated request from ` +
      `disallowed origin: ${origin || refererHeader || "(none)"}`
  )
  res.status(403).json({
    type: "forbidden",
    code: "csrf_origin_rejected",
    message: "Cross-site request blocked: missing or disallowed Origin.",
  })
}
