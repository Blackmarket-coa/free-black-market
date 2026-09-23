import { createLogger } from "../../../shared/logger"
const log = createLogger("api/r/[shortCode]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHash, randomUUID } from "crypto"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../modules/creator-attribution"
import CreatorAttributionService from "../../../modules/creator-attribution/service"
import { hashIpForAttribution } from "../../../lib/attribution-ip-hash"
import { resolveAttributionCookieSecret } from "../../../lib/attribution-cookie-secret"
import { trackingConsented } from "../../../lib/attribution-consent"

/**
 * Public affiliate-link redirector.
 *
 * Resolves a short code to its destination, sets two first-party cookies
 * (signed visitor token + affiliate code), records an `AttributionClickEvent`
 * (best-effort, non-blocking), and 302s to the destination URL with UTM
 * parameters appended.
 *
 * Consent: the cookies and the click identifiers (IP hash, user-agent hash,
 * referrer, country) are written only when the request carries the
 * storefront's `fbm_consent=accepted`. Without it the link still works — the
 * click is counted with no identifiers and an ephemeral visitor token, no
 * cookie is set, and the short code rides to the storefront as `?fbm_ref=`
 * so the storefront can pin the referral itself once the visitor accepts.
 *
 * Mounted at `/r/:shortCode` so creators can drop short URLs anywhere
 * (TikTok bio, Instagram link-in-bio, podcast show notes, etc.).
 */

const VISITOR_COOKIE = "_fbm_visitor"
const AFF_COOKIE = "_fbm_aff"
const COOKIE_MAX_AGE_DAYS = 90

function getStorefrontBase(): string {
  // STORE_CORS is a comma-separated list of allowed storefront origins; first
  // entry doubles as the canonical base for redirect targets when the
  // affiliate link's destination_path is relative.
  const storeCors = process.env.STORE_CORS || ""
  const first = storeCors.split(",").map((s) => s.trim()).filter(Boolean)[0]
  return process.env.STOREFRONT_URL || first || ""
}

function buildRedirectTarget(redirectUrl: string): string {
  if (redirectUrl.startsWith("http")) return redirectUrl
  const base = getStorefrontBase().replace(/\/$/, "")
  return `${base}${redirectUrl.startsWith("/") ? "" : "/"}${redirectUrl}`
}

/**
 * Carry the short code to the storefront as `fbm_ref` so its middleware can
 * pin the referral cookie on its own host — the only place attribution is
 * read — and can do so after consent even when this host set nothing.
 * Only for storefront destinations: an external URL is left untouched.
 */
function withReferral(target: string, redirectUrl: string, shortCode: string): string {
  const base = getStorefrontBase().replace(/\/$/, "")
  const isStorefront = !redirectUrl.startsWith("http") || (base !== "" && target.startsWith(base))
  if (!isStorefront) return target
  try {
    const url = new URL(target)
    if (!url.searchParams.has("fbm_ref")) url.searchParams.set("fbm_ref", shortCode)
    return url.toString()
  } catch {
    return target
  }
}

function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  return createHash("sha256").update(ua).digest("hex").slice(0, 32)
}

function setCookie(
  res: MedusaResponse,
  name: string,
  value: string,
  maxAgeSeconds: number
): void {
  // Append-friendly Set-Cookie so we can set both visitor and aff cookies.
  const existing = res.getHeader("Set-Cookie")
  const next = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, next])
  } else if (typeof existing === "string") {
    res.setHeader("Set-Cookie", [existing, next])
  } else {
    res.setHeader("Set-Cookie", next)
  }
}

function readCookie(req: MedusaRequest, name: string): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  const parts = raw.split(/;\s*/)
  for (const p of parts) {
    const eq = p.indexOf("=")
    if (eq < 0) continue
    if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1))
  }
  return null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const shortCode = (req.params as { shortCode?: string })?.shortCode
  if (!shortCode) {
    res.status(400).send("Missing short code")
    return
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const resolved = await service.resolveShortCode(shortCode)
  if (!resolved) {
    res.status(404).send("Affiliate link not found")
    return
  }

  // Cookie signing key: STOREFRONT_VISITOR_SIGNING_KEY, else JWT_SECRET, else
  // none. Production never reaches the `null` branch because JWT_SECRET is
  // required at boot (shared/config.ts). In a dev/test process with neither
  // set we still honour the link, but set no cookies and record no click:
  // a cookie signed with a known literal would be forgeable, and a click row
  // keyed on an unsigned visitor token would be meaningless.
  const cookieSecret = resolveAttributionCookieSecret()
  const target = withReferral(
    buildRedirectTarget(resolved.redirectUrl),
    resolved.redirectUrl,
    shortCode
  )
  if (!cookieSecret) {
    log.warn(
      "[creator-attribution] no cookie signing key configured; redirecting without attribution cookies"
    )
    res.redirect(302, target)
    return
  }

  // No accepted consent visible on this request: count the click, keep
  // nothing that identifies the visitor, set no cookie. The storefront will
  // attribute from `fbm_ref` on its own host if and when the visitor accepts.
  if (!trackingConsented(req.headers.cookie)) {
    service
      .recordClick({
        shortCode,
        visitorToken: randomUUID(),
        ipHash: null,
        userAgentHash: null,
        referrer: null,
        country: null,
      })
      .catch((err) => {
        log.error("[creator-attribution] recordClick failed", err)
      })
    res.redirect(302, target)
    return
  }

  // Visitor cookie: read existing or mint a new UUID, sign it.
  const existingSignedVisitor = readCookie(req, VISITOR_COOKIE)
  let visitorToken: string | null = null
  if (existingSignedVisitor) {
    visitorToken = CreatorAttributionService.verifyCookieValue(
      existingSignedVisitor,
      cookieSecret
    )
  }
  if (!visitorToken) {
    visitorToken = randomUUID()
  }
  const signedVisitor = CreatorAttributionService.signCookieValue(
    visitorToken,
    cookieSecret
  )
  setCookie(res, VISITOR_COOKIE, signedVisitor, COOKIE_MAX_AGE_DAYS * 24 * 60 * 60)

  // Affiliate cookie: pin to this short code for the cookie window.
  const affPayload = `${shortCode}.${Date.now()}`
  const signedAff = CreatorAttributionService.signCookieValue(affPayload, cookieSecret)
  setCookie(
    res,
    AFF_COOKIE,
    signedAff,
    Number(process.env.CREATOR_ATTRIBUTION_DEFAULT_COOKIE_DAYS || 7) * 24 * 60 * 60
  )

  // Best-effort click recording. We do not await failures.
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null
  const ua = (req.headers["user-agent"] as string | undefined) || null
  const referrer = (req.headers["referer"] as string | undefined) || null
  const country =
    (req.headers["cf-ipcountry"] as string | undefined) ||
    (req.headers["x-vercel-ip-country"] as string | undefined) ||
    null

  service
    .recordClick({
      shortCode,
      visitorToken,
      ipHash: hashIpForAttribution(ip),
      userAgentHash: hashUserAgent(ua),
      referrer,
      country,
    })
    .catch((err) => {
      log.error("[creator-attribution] recordClick failed", err)
    })

  res.redirect(302, target)
}
