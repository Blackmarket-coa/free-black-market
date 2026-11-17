import { createLogger } from "../../shared/logger"
const log = createLogger("api/middlewares/seller-context-v1")
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { decodeAuthTokenFromAuthorization } from "../../shared/auth-helpers"
import { liveSellerIdForActor } from "../../shared/seller-actor"

/**
 * Resolves the authenticated seller for /v1/seller/** routes and attaches
 * { seller_id } to the request. Designed to run AFTER `authenticate("seller", "bearer")`.
 *
 * Differs from ./vendor/_middlewares.ts:ensureSellerContext in that it:
 *   - Has no /vendor/* public-route whitelist (all /v1/seller/* require auth).
 *   - Skips MercurJS-specific actor_id rewriting; /v1/seller/* routes don't
 *     touch MercurJS internals.
 *   - Exposes the canonical `sel_*` seller id as `req.seller_id` for handlers.
 *
 * Like the vendor gate, it resolves a member id only while the member and its
 * store are live, and a seller id only to the live member of that store at the
 * login's own address (shared/seller-actor.ts). It used to take any `sel_*` id
 * as the seller and any `mem_*` row, deleted or not: a removed member, and a
 * member of a closed store, still got 200 here.
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

  if (authContext.actor_id?.startsWith("sel_") || authContext.actor_id?.startsWith("mem_")) {
    try {
      sellerId = await liveSellerIdForActor(req.scope, authContext.actor_id, authContext.auth_identity_id)
    } catch (err) {
      log.error("[v1 seller context] seller lookup failed", err)
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
      sellerId = await liveSellerIdForActor(req.scope, appMetadata?.seller_id, authContext.auth_identity_id)
    } catch (err) {
      log.error("[v1 seller context] auth identity lookup failed", err)
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
