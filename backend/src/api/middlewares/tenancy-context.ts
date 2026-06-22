import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../modules/tenancy"
import TenancyModuleService, { TenancyRole, TierFlag } from "../../modules/tenancy/service"

const actorFromRequest = (req: MedusaRequest) => {
  const authContext = (req as AuthenticatedMedusaRequest).auth_context as
    | { actor_id?: string; user_id?: string }
    | undefined
  return String(authContext?.actor_id || authContext?.user_id || "")
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
