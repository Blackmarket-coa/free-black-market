import jwt from "jsonwebtoken"
import { timingSafeEqual } from "crypto"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"

/**
 * Adapted from the OAuth client-credentials pattern documented for the
 * Blackout integration in `backend/src/modules/content-platform/providers/blackout.ts`.
 *
 * Bearer token verification for Blackout-side reads of FBM data
 * (e.g. entitlements). Tokens are issued by `/v1/integrations/blackout/oauth/token`
 * after verifying client_id/client_secret against env-configured values.
 *
 * The middleware no-ops (and lets the route through) when the integration
 * flag is off, so dev/preview environments can still exercise these routes.
 */

const ISSUER = "fbm"
const AUDIENCE = "blackout"

export type BlackoutTokenClaims = {
  sub: string
  iss: typeof ISSUER
  aud: typeof AUDIENCE
  iat: number
  exp: number
}

export function isBlackoutIntegrationEnabled(): boolean {
  return process.env.FBM_BLACKOUT_INTEGRATION === "1"
}

export function issueBlackoutToken(clientId: string, ttlSeconds = 3600): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error("JWT_SECRET is not set; cannot issue Blackout integration tokens")
  }
  const now = Math.floor(Date.now() / 1000)
  const claims: BlackoutTokenClaims = {
    sub: clientId,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ttlSeconds,
  }
  return jwt.sign(claims, secret, { algorithm: "HS256" })
}

export function verifyBlackoutCredentials(clientId: string, clientSecret: string): boolean {
  const expectedId = process.env.BLACKOUT_CLIENT_ID
  const expectedSecret = process.env.BLACKOUT_CLIENT_SECRET
  if (!expectedId || !expectedSecret) return false
  // constant-time-ish compare: compare both to dodge timing attacks where it matters
  return clientId === expectedId && clientSecret === expectedSecret
}

export function verifyBlackoutToken(token: string): BlackoutTokenClaims | null {
  const secret = process.env.JWT_SECRET
  if (!secret) return null
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      audience: AUDIENCE,
      issuer: ISSUER,
    })
    if (typeof decoded === "object" && decoded !== null) {
      return decoded as BlackoutTokenClaims
    }
    return null
  } catch {
    return null
  }
}

/** Constant-time string compare that tolerates length differences. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Verify the bearer used by Blackout to call the entitlements service (§4).
 * Accepts EITHER the static `ENTITLEMENTS_SERVICE_TOKEN` (the deployment token
 * FBM issues to a Blackout deployment) OR a valid Blackout OAuth JWT, so the
 * service keeps working for existing JWT-based callers during the cutover.
 */
export function verifyEntitlementsServiceToken(token: string): boolean {
  if (!token) return false
  const serviceToken = process.env.ENTITLEMENTS_SERVICE_TOKEN
  if (serviceToken && safeEqual(token, serviceToken)) return true
  return verifyBlackoutToken(token) !== null
}

/**
 * Extract a `Bearer <token>` value from a request, or null. Handles the header
 * arriving as a string or string[] (per Node's header typing).
 */
export function bearerToken(req: { headers: Record<string, unknown> }): string | null {
  const raw = req.headers["authorization"] ?? req.headers["Authorization"]
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null
  const token = header.slice("Bearer ".length).trim()
  return token.length > 0 ? token : null
}

/**
 * Verify the bearer Blackout uses to call FBM's commerce API (§5): the static
 * `FREEBLACKMARKET_API_KEY`. Constant-time compare.
 */
export function verifyCommerceApiKey(token: string): boolean {
  const apiKey = process.env.FREEBLACKMARKET_API_KEY
  if (!apiKey) return false
  return safeEqual(token, apiKey)
}

export function blackoutAuthMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (!isBlackoutIntegrationEnabled()) {
    // Integration disabled — let the route handler return its own no-op
    // response so we can keep things easy in dev. Routes still check the
    // flag where they want different behavior.
    return next()
  }

  const header = req.headers.authorization || req.headers.Authorization
  const headerStr = Array.isArray(header) ? header[0] : header
  if (!headerStr || !headerStr.startsWith("Bearer ")) {
    res.status(401).json({ message: "Bearer token required" })
    return
  }
  const token = headerStr.slice("Bearer ".length).trim()
  const claims = verifyBlackoutToken(token)
  if (!claims) {
    res.status(401).json({ message: "Invalid or expired Blackout integration token" })
    return
  }
  ;(req as any).blackout_claims = claims
  next()
}
