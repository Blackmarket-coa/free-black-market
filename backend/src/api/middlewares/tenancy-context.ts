import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../modules/tenancy"
import TenancyModuleService, { TenancyRole, TierFlag } from "../../modules/tenancy/service"

const actorFromRequest = (req: MedusaRequest) => {
  const authContext = (req as AuthenticatedMedusaRequest).auth_context as
    | { actor_id?: string; user_id?: string }
    | undefined
  return String(authContext?.actor_id || authContext?.user_id || "")
}

export type StorefrontContext = {
  organization_id: string
  storefront_id: string
  role: string
  tier: TierFlag
  gates: Record<string, boolean>
}

/**
 * Attach storefront context when the caller supplies it; do nothing when they
 * do not.
 *
 * The non-blocking counterpart to `requireStorefrontContext`, and the only
 * shape that can safely go anywhere near `/vendor/*`. `requireStorefrontContext`
 * **400s when the two context headers are absent** — correct for the four admin
 * donation routes, which are only ever called by a panel that sends them, but
 * fatal anywhere else: the vendor panel has never sent those headers, so
 * mounting the required form across `/vendor/**` would 400 every vendor request
 * in the system on deploy. That is the catch-all outage shape, arrived at from
 * a different direction than the one the roadmap warned about.
 *
 * This one resolves the context if the headers are present and valid, leaves
 * `storefront_context` undefined otherwise, and never writes a response. A
 * white-label panel that knows its organization gets the context; the ordinary
 * vendor panel is unaffected.
 *
 * Note that this deliberately does **not** gate anything. Enterprise
 * entitlement already flows through `requirePlanFeature` via the tier floor in
 * `shared/seller-plan.ts`, so a tenant's sellers get their features without a
 * second gate on the request path — one gate, one denial format, one cache.
 */
export const attachStorefrontContext = () => {
  return async (req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) => {
    const organization_id = String(req.headers["x-organization-id"] || "")
    const storefront_id = String(req.headers["x-storefront-id"] || "")

    if (!organization_id || !storefront_id) return next()

    try {
      const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
      const context = await service.resolveContext({
        user_id: actorFromRequest(req),
        organization_id,
        storefront_id,
      })

      if (context.storefront && context.membership) {
        ;(req as MedusaRequest & { storefront_context?: StorefrontContext }).storefront_context = {
          organization_id,
          storefront_id,
          role: String(context.membership.role),
          tier: context.tier,
          gates: service.featureGatesForTier(context.tier),
        }
      }
    } catch {
      // Resolution is advisory here. A tenancy blip must not fail a request
      // that would have succeeded without any context at all.
    }

    next()
  }
}

export const requireStorefrontContext = (requiredRoles?: TenancyRole[], minimumTier?: TierFlag) => {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const organization_id = String(req.headers["x-organization-id"] || "")
    const storefront_id = String(req.headers["x-storefront-id"] || "")

    if (!organization_id || !storefront_id) {
      return res.status(400).json({
        message: "Missing required storefront context headers",
        required_headers: ["x-organization-id", "x-storefront-id"],
      })
    }

    const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
    const context = await service.resolveContext({
      user_id: actorFromRequest(req),
      organization_id,
      storefront_id,
    })

    if (!context.storefront || !context.membership) {
      return res.status(403).json({ message: "Access denied for selected organization/storefront context" })
    }

    if (requiredRoles?.length && !service.canAccessRole(context.membership.role as TenancyRole, requiredRoles)) {
      return res.status(403).json({ message: "Role not permitted for this action" })
    }

    if (minimumTier && !service.hasMinimumTier(context.tier, minimumTier)) {
      return res.status(403).json({
        message: `Feature requires minimum tier ${minimumTier}`,
        storefront_tier: context.tier,
      })
    }

    ;(req as MedusaRequest & { storefront_context?: unknown }).storefront_context = {
      organization_id,
      storefront_id,
      role: context.membership.role,
      tier: context.tier,
      gates: service.featureGatesForTier(context.tier),
    }

    next()
  }
}
