import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { decodeAuthTokenFromAuthorization } from "../../shared/auth-helpers"

/**
 * Resolves the authenticated seller for /v1/seller/** routes and attaches
 * { seller_id } to the request. Designed to run AFTER `authenticate("seller", "bearer")`.
 *
 * Differs from ./vendor/_middlewares.ts:ensureSellerContext in that it:
 *   - Has no /vendor/* public-route whitelist (all /v1/seller/* require auth).
 *   - Skips MercurJS-specific actor_id rewriting; /v1/seller/* routes don't
 *     touch MercurJS internals.
 *   - Exposes the canonical `sel_*` seller id as `req.seller_id` for handlers.
 */
export interface SellerAuthRequest extends MedusaRequest {
  seller_id?: string
}

export async function requireSellerContextV1(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const requestWithAuth = req as MedusaRequest & {
    auth_context?: {
      actor_id?: string
      actor_type?: string
      auth_identity_id?: string
    }
  }
  const authContext = requestWithAuth.auth_context ?? {}
  const decoded = decodeAuthTokenFromAuthorization(req.headers.authorization)

  if (!authContext.actor_id && decoded?.actorId) {
    authContext.actor_id = decoded.actorId
  }
  if (!authContext.actor_type && decoded?.actorType) {
    authContext.actor_type = decoded.actorType
  }
  if (!authContext.auth_identity_id && decoded?.authIdentityId) {
    authContext.auth_identity_id = decoded.authIdentityId
  }
  if (!authContext.actor_id && decoded?.sellerId) {
    authContext.actor_id = decoded.sellerId
    authContext.actor_type = authContext.actor_type ?? "seller"
  }

  let sellerId: string | null = null

  if (authContext.actor_id?.startsWith("sel_")) {
    sellerId = authContext.actor_id
  } else if (authContext.actor_id?.startsWith("mem_")) {
    try {
      const pgConnection = req.scope.resolve(
        ContainerRegistrationKeys.PG_CONNECTION
      )
      const result = await pgConnection.raw(
        `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
        [authContext.actor_id]
      )
      sellerId = result.rows?.[0]?.seller_id ?? null
    } catch (err) {
      console.error("[v1 seller context] member lookup failed", err)
    }
  } else if (authContext.auth_identity_id) {
    try {
      const authModule = req.scope.resolve(Modules.AUTH)
      const identities = await authModule.listAuthIdentities({
        id: [authContext.auth_identity_id],
      })
      const appMetadata = identities?.[0]?.app_metadata as
        | { seller_id?: string }
        | undefined
      const linked = appMetadata?.seller_id
      if (linked?.startsWith("sel_")) {
        sellerId = linked
      } else if (linked?.startsWith("mem_")) {
        const pgConnection = req.scope.resolve(
          ContainerRegistrationKeys.PG_CONNECTION
        )
        const result = await pgConnection.raw(
          `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
          [linked]
        )
        sellerId = result.rows?.[0]?.seller_id ?? null
      }
    } catch (err) {
      console.error("[v1 seller context] auth identity lookup failed", err)
    }
  }

  if (!sellerId) {
    res.status(401).json({
      message: "Unauthorized - seller authentication required",
      type: "unauthorized",
    })
    return
  }

  ;(req as SellerAuthRequest).seller_id = sellerId
  next()
}
