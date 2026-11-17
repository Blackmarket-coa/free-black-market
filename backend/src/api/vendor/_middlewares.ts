/**
 * Vendor seller-context guard, imported by `src/api/middlewares.ts` and
 * registered there on `/vendor/**`.
 *
 * This file used to also `export default defineMiddlewares(...)` with its own
 * vendorCorsMiddleware on `/vendor/**`. Medusa never loaded it (only the root
 * `src/api/middlewares.ts` is read), and the live CORS is the root file's
 * stricter vendorCorsMiddleware — this copy allowed any `*.freeblackmarket.com`
 * subdomain and `*.up.railway.app` with credentials regardless of NODE_ENV.
 * The dead default export was removed rather than wired, so nobody edits it
 * believing it runs. `src/api/__tests__/nested-middlewares.unit.spec.ts`
 * refuses a default export in any nested middleware file.
 */
import { createLogger } from "../../shared/logger"
import type { VendorRequest } from "./types"
const log = createLogger("api/vendor/_middlewares")
import { getAuthContextFromJwtToken } from "@medusajs/framework/http"
import type { AuthContext, MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import type { ConfigModule } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { liveSellerIdOfMember, resolveSellerActor } from "../../shared/seller-actor"
import { handleSellerRegistration } from "../shared/seller-registration"

/** What the gate validates and pins: Medusa's auth context, and the member it acts as. */
type GateAuthContext = Partial<AuthContext> & { member_id?: string }

/**
 * The seller bearer token on this request, read the way Medusa's authenticate
 * reads one (the same header parsing, secret or public key, verify options and
 * actor-type rule): the token Mercur's checkSellerApproved accepted before
 * this gate, and the one a route-level `authenticate("seller", "bearer")`
 * reads again after it. `refused` is a bearer this server did not sign for a
 * seller, or one that has expired.
 */
function sellerBearerOf(
  req: MedusaRequest
): { kind: "none" } | { kind: "refused" } | { kind: "seller"; context: AuthContext } {
  const header = req.headers.authorization
  const match = typeof header === "string" ? header.match(/(\S+)\s+(\S+)/) : null
  if (!match || match[1].toLowerCase() !== "bearer") {
    return { kind: "none" }
  }
  const { http } = req.scope.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig
  if (!http.jwtSecret && !http.jwtPublicKey) {
    return { kind: "refused" }
  }
  const context = getAuthContextFromJwtToken(
    header,
    http.jwtSecret ?? "",
    ["bearer"],
    ["seller"],
    http.jwtPublicKey,
    http.jwtVerifyOptions ?? http.jwtOptions
  )
  return context ? { kind: "seller", context } : { kind: "refused" }
}

/**
 * The seller login a session cookie carries: the context a seller
 * `authenticate` would read from it. Another actor type's session (an admin
 * signed in to the admin panel in the same browser) is never read by a seller
 * `authenticate`, so it names no seller here.
 */
function sellerSessionOf(req: MedusaRequest): Partial<AuthContext> | null {
  const context = (req as MedusaRequest & { session?: { auth_context?: Partial<AuthContext> } }).session
    ?.auth_context
  return context && context.actor_type === "seller" ? context : null
}

const PINNED_FIELDS = ["actor_id", "actor_type", "auth_identity_id", "member_id"] as const

/**
 * Fixes `req.auth_context`, for every middleware and handler after the gate,
 * to the caller the gate validated.
 *
 * Medusa's authenticate assigns `req.auth_context` wholesale, and route-level
 * `authenticate("seller", "bearer")` matchers in `api/middlewares.ts` run
 * after this gate on dozens of vendor paths. Whatever was assigned last was
 * what the handler acted as, and only a converted seller id was protected
 * (and only from an assignment naming that same seller id).
 *
 * A later assignment is ignored, and the validated context stays: forced back,
 * not refused. This setter runs inside other middleware, Medusa's authenticate
 * among them, where it cannot answer the request, and a throw there becomes an
 * answer only if that middleware happens to be wrapped to turn it into one.
 * Refusing a request whose credentials disagree is done once, at the gate,
 * before any of them run: a seller session for another login is a 401. What
 * reaches the setter after that is the same login read again (a seller-id
 * token keeps acting as its member); anything naming another login or actor
 * is logged. The identity fields of the pinned context ignore writes the same
 * way.
 */
function pinCaller(req: MedusaRequest, validated: GateAuthContext, rawActorId: string | undefined): void {
  const pinned: GateAuthContext = { ...validated }
  for (const field of PINNED_FIELDS) {
    const value = validated[field]
    Object.defineProperty(pinned, field, {
      get: () => value,
      set: (next: unknown) => {
        if (next !== value) {
          log.warn(`[VENDOR AUTH] Ignored a write of auth_context.${field} after the gate validated ${String(value)}`)
        }
      },
      enumerable: true,
      configurable: false,
    })
  }
  Object.defineProperty(req, "auth_context", {
    get: () => pinned,
    set: (next: GateAuthContext | undefined) => {
      if (next === pinned) {
        return
      }
      const sameLogin = next?.auth_identity_id === pinned.auth_identity_id
      const sameActor = next?.actor_id === pinned.actor_id || next?.actor_id === rawActorId
      if (!sameLogin || !sameActor) {
        log.warn(
          `[VENDOR AUTH] Ignored an auth_context naming login ${String(next?.auth_identity_id)} and actor ${String(
            next?.actor_id
          )} after the gate validated login ${String(pinned.auth_identity_id)} as ${String(pinned.actor_id)}`
        )
      }
    },
    enumerable: true,
    configurable: false,
  })
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
    // Completing email verification is necessarily anonymous — the caller is
    // proving control of a mailbox, and has no seller yet to be in the context
    // of. `export const AUTHENTICATE = false` on the route does not reach this:
    // it disables Medusa's own authenticate middleware, not a defineMiddlewares
    // entry, and `/vendor/**` is guarded here.
    ["/vendor/verify-email", new Set(["POST"])],
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
  if ((req as VendorRequest)._sellerContextResolved) {
    next()
    return
  }

  // Who is asking. Mercur's checkSellerApproved, which runs before this gate,
  // reads only the bearer token and lets through any seller token with an
  // actor; Mercur's authenticate after it prefers the session cookie. So the
  // actor this gate used to validate (the session's) need not be the one
  // Mercur let through, and a route-level authenticate("seller", "bearer")
  // later put the bearer's actor in front of the handler, unvalidated: a
  // removed member's bearer with a live seller's cookie read and wrote
  // invoices under the removed member, and Mercur's own lookup found the
  // store's promotions through it (follow-up re-review, R-c). The bearer, when
  // there is one, is now the caller, and a seller session for another login
  // alongside it is refused: nothing says which of the two is asking. With no
  // bearer, the context Mercur's authenticate read stays the caller.
  const bearer = sellerBearerOf(req)
  if (bearer.kind === "refused") {
    res.status(401).json({
      message: "Unauthorized - seller authentication required",
      type: "unauthorized",
    })
    return
  }
  const sellerSession = sellerSessionOf(req)
  if (bearer.kind === "seller" && sellerSession && sellerSession.auth_identity_id !== bearer.context.auth_identity_id) {
    log.warn(
      `[VENDOR AUTH] Refused a request whose seller session (login ${String(
        sellerSession.auth_identity_id
      )}) and bearer token (login ${bearer.context.auth_identity_id}) name different logins`
    )
    res.status(401).json({
      message: "The session and the token on this request belong to different sellers. Sign in again.",
      type: "unauthorized",
    })
    return
  }

  const requestWithAuth = req as MedusaRequest & { auth_context?: GateAuthContext }
  // A copy: a session's context is the object express-session saves.
  const authContext: GateAuthContext = {
    ...(bearer.kind === "seller" ? bearer.context : requestWithAuth.auth_context ?? {}),
  }
  const rawActorId = authContext.actor_id

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
    // A seller id acts as the live member of that store whose email is the
    // login's own address, and as nothing without one (shared/seller-actor.ts).
    // It used to act as the store's first live member, its owner, for any
    // login holding it, a removed member's included; and finding none was
    // not a refusal at all. Mercur's member-keyed guards get the matched
    // member as the actor.
    let matched: Awaited<ReturnType<typeof resolveSellerActor>> = null
    try {
      matched = await resolveSellerActor(req.scope, authContext.actor_id, authContext.auth_identity_id)
    } catch (error) {
      log.error("[VENDOR AUTH] Failed to resolve a seller-id actor:", error)
      res.status(500).json({
        message: "Failed to validate seller context",
        type: "server_error",
      })
      return
    }
    if (!matched) {
      res.status(401).json({
        message: "Seller not found for authenticated user",
        type: "unauthorized",
      })
      return
    }
    // The store, for route handlers that need it.
    ;(req as VendorRequest)._seller_id = matched.sellerId
    authContext.actor_id = matched.memberId
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
    let sellerId = (req as VendorRequest)._seller_id || authContext.actor_id
    if (sellerId.startsWith("mem_")) {
      // Only a member that is still on the team, of a store that is still
      // open. Mercur's deleteMemberStep soft-deletes a removed member and
      // leaves the login's link naming it, and signing in mints that member as
      // the actor again; read without `deleted_at`, a removed member's tokens
      // kept reading the store's orders and customers' addresses and could
      // write. It is now refused like a member that no longer exists. Mercur's
      // own guards cannot do this for us: storeActiveGuard lets every GET
      // through and finds the store through a removed member anyway
      // (fetchSellerByAuthActorId filters `members.id`, which matches
      // soft-deleted rows).
      const resolvedSellerId = await liveSellerIdOfMember(req.scope, sellerId)
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

  // Past this point the actor is a live member of a live store, whichever
  // kind of id the caller presented: what every handler after the gate sees.
  authContext.member_id = authContext.actor_id
  pinCaller(req, authContext, rawActorId)
  ;(req as VendorRequest)._sellerContextResolved = true
  next()
}
