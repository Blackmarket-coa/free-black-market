import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { createLogger } from "../../shared/logger"
import {
  getCachedPlanFeatures,
  setCachedPlanFeatures,
} from "../../shared/plan-entitlement-cache"
import { loadSellerPlanSnapshot } from "../../shared/seller-plan"
import type { VendorFeatureKey } from "../../modules/vendor-plan/catalog"

const log = createLogger("api/middlewares/require-plan-feature")

export type PlanGateOptions = {
  /** Override the denial status. Defaults to 402. */
  status?: 402 | 403 | 404
  /** Methods to leave open, e.g. `["GET"]` to gate writes only. */
  exceptMethods?: string[]
}

/**
 * Resolve the authenticated seller without re-deriving it.
 *
 * `ensureSellerContext` (`api/vendor/_middlewares.ts`) already sets
 * `req.seller` from a `query.graph` on the canonical `sel_*` id, on every
 * authenticated `/vendor/**` request — including the `mem_ -> sel_` rewrite
 * path. So the `sel_`/`mem_` tangle never has to enter this gate.
 *
 * `req.seller_id` is the `/v1/seller/**` shape (`seller-context-v1`), included
 * so the same factory can gate those routes later.
 *
 * Deliberately does NOT call `requireSellerId` — that helper writes its own 401
 * response and issues one to two extra queries per call.
 */
function resolveSellerId(req: MedusaRequest): string | null {
  const r = req as MedusaRequest & {
    seller?: { id?: string }
    _seller_id?: string
    seller_id?: string
    auth_context?: { actor_id?: string }
  }

  const fromContext = r.seller?.id || r._seller_id || r.seller_id
  if (fromContext) return fromContext

  const actorId = r.auth_context?.actor_id
  return actorId && actorId.startsWith("sel_") ? actorId : null
}

/**
 * Gate a route on a billing-plan feature key.
 *
 * Compose it AFTER the feature-flag gate, so the platform kill switch is
 * evaluated before the paywall — never offer to sell something the deployment
 * has switched off:
 *
 *   middlewares: [
 *     authenticate("seller", "bearer"),
 *     requireFeatureFlagMiddleware("POS_V1"),  // does it exist here?  -> 404
 *     requirePlanFeature("vendor.pos"),        // may you have it?     -> 402
 *   ]
 */
export function requirePlanFeature(
  featureKey: VendorFeatureKey,
  options: PlanGateOptions = {}
) {
  const denialStatus = options.status ?? 402
  const exceptMethods = new Set(
    (options.exceptMethods ?? []).map((m) => m.toUpperCase())
  )

  return async function requirePlanFeatureMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    if (exceptMethods.has((req.method || "").toUpperCase())) {
      return next()
    }

    const sellerId = resolveSellerId(req)
    if (!sellerId) {
      // Not an error to handle here. `ensureSellerContext` runs first on
      // `/vendor/**` and already 401s when it cannot resolve a seller, so
      // arriving here without one means a whitelisted public route (register,
      // registration-status). Emitting a second, differently shaped 401 would
      // be a regression.
      return next()
    }

    let snapshot = getCachedPlanFeatures(sellerId)

    if (!snapshot) {
      try {
        snapshot = await loadSellerPlanSnapshot(req.scope, sellerId)
        setCachedPlanFeatures(sellerId, snapshot)
      } catch (err) {
        // Fail closed, but distinguishably. A 402 here would be a lie that
        // fires an upsell at a paying vendor; an open gate would hand out paid
        // features on a database blip.
        log.error(
          `[plan-gate] entitlement lookup failed for ${sellerId} on ${featureKey}`,
          err
        )
        return res.status(503).json({
          type: "plan_check_unavailable",
          code: "plan_check_unavailable",
          message: "Unable to verify plan entitlements. Please retry.",
        })
      }
    }

    if (snapshot.feature_keys.has(featureKey)) {
      return next()
    }

    return res.status(denialStatus).json({
      // Emitted as a superset of the three denial conventions in this codebase
      // (`{message,type}` from middleware, `{message}` from most handlers,
      // `{code,message}` from /v1 and access-check) so every existing client
      // shape keeps working.
      type: "plan_upgrade_required",
      code: "plan_upgrade_required",
      message: `Your ${snapshot.plan_code} plan does not include this feature. Upgrade to enable it.`,
      required_feature: featureKey,
      current_plan: snapshot.plan_code,
      upgrade_url: "/settings/billing",
    })
  }
}
