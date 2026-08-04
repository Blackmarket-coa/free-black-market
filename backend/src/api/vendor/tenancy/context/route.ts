import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import type TenancyModuleService from "../../../../modules/tenancy/service"
import {
  featureGatesForTier,
  gatesGrantedByTier,
  vendorFeatureKeysForTier,
} from "../../../../modules/tenancy/gates"

const log = createLogger("api/vendor/tenancy/context")

/**
 * GET /vendor/tenancy/context — what this seller's organization grants them.
 *
 * A seller inside a white-label organization gets plan features they never
 * bought, because their organization's tier floors their entitlements
 * (`shared/seller-plan.ts`). Without this route those features would simply
 * appear, with the billing page showing a plan that does not list them — which
 * reads as a bug, or worse, as something that might be withdrawn without
 * notice. This is the explanation.
 *
 * Not plan-gated, for the same reason `/vendor/usage` and `/vendor/billing`
 * are not: it describes the seller's own commercial position, and gating it
 * would hide that position from whoever has the least of it.
 *
 * A seller with no tenancy membership — every ordinary FBM vendor — gets
 * `tier0_public` with an empty grant list, not a 404. "You are not part of an
 * organization" is a real answer to this question.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const tenancy = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
    const tier = await tenancy.resolveSellerTier(sellerId)

    return res.json({
      tier,
      /** True once the seller is inside an organization that grants anything. */
      in_organization: tier !== "tier0_public",
      gates: featureGatesForTier(tier),
      granted_gates: gatesGrantedByTier(tier),
      /**
       * The plan features this tier floors. Named as a grant rather than as
       * the seller's entitlements, because their own plan may well include
       * more — the floor only ever raises.
       */
      granted_feature_keys: vendorFeatureKeysForTier(tier),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/tenancy/context] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load tenancy context" })
  }
}
