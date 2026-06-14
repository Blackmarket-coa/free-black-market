import { createLogger } from "../../shared/logger"
const log = createLogger("api/vendor/_middlewares")
import { defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { decodeAuthTokenFromAuthorization } from "../../shared/auth-helpers"
import { handleSellerRegistration } from "../shared/seller-registration"

/**
 * Vendor-specific CORS middleware
 *
 * This middleware handles CORS for all /vendor/* routes, including those
 * handled by the @mercurjs/b2c-core plugin.
 *
 * Placed in src/api/vendor/ to ensure it runs for all vendor routes.
 */
async function vendorCorsMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const origin = req.headers.origin || ""

  // Get allowed origins from environment
  const vendorCors = process.env.VENDOR_CORS || ""
  const storeCors = process.env.STORE_CORS || ""
  const authCors = process.env.AUTH_CORS || ""

  // Build list of allowed origins
  const allowedOrigins = new Set<string>()

  vendorCors.split(",").map(o => o.trim()).filter(Boolean).forEach(o => allowedOrigins.add(o))
  storeCors.split(",").map(o => o.trim()).filter(Boolean).forEach(o => allowedOrigins.add(o))
  authCors.split(",").map(o => o.trim()).filter(Boolean).forEach(o => allowedOrigins.add(o))

  // Always allow freeblackmarket.com domains
  allowedOrigins.add("https://vendor.freeblackmarket.com")
  allowedOrigins.add("https://freeblackmarket.com")
  allowedOrigins.add("https://www.freeblackmarket.com")

  let matchedOrigin = ""

  if (origin) {
    // Exact match
    if (allowedOrigins.has(origin)) {
      matchedOrigin = origin
    }
    // Try without trailing slash
    else if (allowedOrigins.has(origin.replace(/\/$/, ""))) {
      matchedOrigin = origin.replace(/\/$/, "")
    }
    // Fallback: Allow known domains
    else {
      try {
        const originUrl = new URL(origin)
        const hostname = originUrl.hostname.toLowerCase()

        // Allow any *.freeblackmarket.com subdomain
        if (hostname.endsWith(".freeblackmarket.com") || hostname === "freeblackmarket.com") {
          matchedOrigin = origin
        }
        // Allow Railway preview deployments
        else if (hostname.endsWith(".up.railway.app")) {
          matchedOrigin = origin
        }
      } catch (_e) {
        // Invalid origin URL
      }
    }
  }

  if (matchedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", matchedOrigin)
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Publishable-API-Key, x-publishable-api-key, X-Medusa-Access-Token, Cookie")
    res.setHeader("Access-Control-Max-Age", "86400")
    res.setHeader("Vary", "Origin")
  } else if (origin) {
    log.warn(`[VENDOR CORS] Origin not allowed: "${origin}"`)
  }

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).end()
    return
  }

  next()
}

export async function ensureSellerContext(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const publicRoutes = new Map<string, Set<string>>([
    ["/vendor/register", new Set(["POST"])],
    ["/vendor/registration-status", new Set(["GET"])],
    ["/vendor/sellers", new Set(["POST"])],
  ])

  const rawPath = req.originalUrl || req.url || req.path || ""
  const requestPath = rawPath.split("?")[0]
  const isPublicRoute =
    requestPath &&
    publicRoutes.has(requestPath) &&
    publicRoutes.get(requestPath)!.has(req.method.toUpperCase())

  if (requestPath === "/vendor/registration-status" && req.method.toUpperCase() === "GET") {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https"
    const host = req.headers["x-forwarded-host"] || req.headers.host
    const baseUrl = `${protocol}://${host}`
    res.redirect(307, `${baseUrl}/auth/seller/registration-status`)
    return
  }

  if (requestPath === "/vendor/register" && req.method.toUpperCase() === "POST") {
    await handleSellerRegistration(req, res)
    return
  }

  if (isPublicRoute) {
    next()
    return
  }

  // Skip if already processed by a previous middleware invocation
  // (this middleware may be registered multiple times via different matchers)
  if ((req as any)._sellerContextResolved) {
    next()
    return
  }

  const requestWithAuth = req as MedusaRequest & {
    auth_context?: {
      actor_id?: string
      actor_type?: string
      auth_identity_id?: string
      member_id?: string
    }
  }
  const authContext = requestWithAuth.auth_context ?? {}
  const decodedToken = decodeAuthTokenFromAuthorization(req.headers.authorization)

  if (!requestWithAuth.auth_context) {
    requestWithAuth.auth_context = authContext
  }

  if (!authContext.actor_id && decodedToken?.actorId) {
    authContext.actor_id = decodedToken.actorId
  }

  if (!authContext.actor_type && decodedToken?.actorType) {
    authContext.actor_type = decodedToken.actorType
  }

  if (!authContext.auth_identity_id && decodedToken?.authIdentityId) {
    authContext.auth_identity_id = decodedToken.authIdentityId
  }

  if (!authContext.actor_id && decodedToken?.sellerId) {
    authContext.actor_id = decodedToken.sellerId
    authContext.actor_type = authContext.actor_type ?? "seller"
  }

  if (!authContext.actor_id && authContext.auth_identity_id) {
    const authModule = req.scope.resolve(Modules.AUTH)
    const identities = await authModule.listAuthIdentities({ id: [authContext.auth_identity_id] })
    const appMetadata = identities?.[0]?.app_metadata as { seller_id?: string } | undefined
    if (appMetadata?.seller_id) {
      authContext.actor_id = appMetadata.seller_id
      authContext.actor_type = authContext.actor_type ?? "seller"
    }
  }

  if (authContext.actor_id?.startsWith("sel_")) {
    // Store original seller ID for route handlers that need it
    ;(req as any)._seller_id = authContext.actor_id

    // Try to convert seller ID to member ID for MercurJS compatibility.
    // MercurJS storeActiveGuard queries sellers by members.id,
    // so having a mem_* actor_id is preferred. However, the patched
    // fetchSellerByAuthActorId (via scripts/patch-mercurjs.js) now handles
    // sel_* IDs as a fallback, so this conversion is best-effort.
    try {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const memberResult = await pgConnection.raw(
        `SELECT id FROM member WHERE seller_id = ? ORDER BY created_at ASC LIMIT 1`,
        [authContext.actor_id]
      )
      const memberId = memberResult.rows?.[0]?.id
      if (memberId) {
        const originalSellerId = authContext.actor_id
        authContext.member_id = memberId
        authContext.actor_id = memberId

        // Intercept future auth_context assignments to ensure actor_id stays as member ID.
        // MedusaJS authenticate middleware may replace req.auth_context with JWT data
        // containing the original seller ID.
        let _currentAuthContext = requestWithAuth.auth_context
        Object.defineProperty(req, "auth_context", {
          get() {
            return _currentAuthContext
          },
          set(value: any) {
            _currentAuthContext = value
            if (value && value.actor_id === originalSellerId) {
              value.actor_id = memberId
            }
          },
          configurable: true,
          enumerable: true,
        })
      }
      // If no member found, continue anyway - the patched MercurJS code
      // handles sel_* IDs via direct seller lookup as a fallback
    } catch {
      // Non-fatal: if member lookup fails, patched MercurJS handles it
    }
  }

  const actorType = authContext.actor_type
  const isSellerActor = actorType === "seller" || actorType === "member"

  if (!authContext.actor_id || (!isSellerActor && !authContext.actor_id.startsWith("sel_") && !authContext.actor_id.startsWith("mem_"))) {
    res.status(401).json({
      message: "Unauthorized - seller authentication required",
      type: "unauthorized",
    })
    return
  }

  try {
    // Use pre-resolved seller ID if available (from sel_* to mem_* conversion above)
    let sellerId = (req as any)._seller_id || authContext.actor_id
    if (sellerId.startsWith("mem_")) {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const memberResult = await pgConnection.raw(
        `
        SELECT seller_id
        FROM member
        WHERE id = ?
        `,
        [sellerId]
      )
      const resolvedSellerId = memberResult.rows?.[0]?.seller_id
      if (!resolvedSellerId) {
        res.status(401).json({
          message: "Seller not found for authenticated member",
          type: "unauthorized",
        })
        return
      }
      sellerId = resolvedSellerId
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id", "store_status"],
      filters: { id: sellerId },
    })

    if (!sellers || sellers.length === 0) {
      res.status(401).json({
        message: "Seller not found for authenticated user",
        type: "unauthorized",
      })
      return
    }

    const seller = sellers[0]
    ;(req as MedusaRequest & { seller?: unknown }).seller = seller
  } catch (error) {
    log.error("[VENDOR AUTH] Failed to validate seller context:", error)
    res.status(500).json({
      message: "Failed to validate seller context",
      type: "server_error",
    })
    return
  }

  ;(req as any)._sellerContextResolved = true
  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/vendor/**",
      middlewares: [vendorCorsMiddleware, ensureSellerContext],
    },
  ],
})
