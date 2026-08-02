import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../../shared"
import { createLogger } from "../../../../shared/logger"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import type VendorPlanService from "../../../../modules/vendor-plan/service"
import { VENDOR_PLAN_CATALOG } from "../../../../modules/vendor-plan/catalog"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../modules/entitlement/service"

const log = createLogger("api/vendor/plan/me")

/**
 * GET /vendor/plan/me
 *
 * The seller's current plan, the feature keys they actually hold, and the
 * plans they could move to. This is what the panel reads to decide which paid
 * surfaces to show and what to offer on the upgrade screen.
 *
 * `feature_keys` is the same union the gate enforces — plan features plus any
 * directly held seller entitlements — so the UI and the gate cannot disagree
 * about what a vendor has.
 *
 * Deliberately NOT behind `requirePlanFeature`: a vendor must always be able to
 * see and change their own plan, especially when their current one is the
 * reason something else is denied.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const plans = req.scope.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
    const assignment = await plans.ensureAssignment(sellerId)
    const planKeys = await plans.getEntitledFeatureKeys(sellerId)

    const featureKeys = new Set<string>(planKeys)
    try {
      const entitlements = req.scope.resolve<EntitlementModuleService>(
        ENTITLEMENT_MODULE
      )
      for (const key of await entitlements.listActiveFeatureKeysForSeller(
        sellerId
      )) {
        featureKeys.add(key)
      }
    } catch (err) {
      // Additive only — a failed entitlement read must not hide the plan.
      log.warn("[plan/me] seller entitlement read failed", err)
    }

    return res.json({
      plan: {
        code: assignment.plan_code,
        status: assignment.status,
        current_period_end: assignment.current_period_end ?? null,
        trial_ends_at: assignment.trial_ends_at ?? null,
        cancel_at_period_end: !!assignment.cancel_at_period_end,
        pending_plan_code: assignment.pending_plan_code ?? null,
        pending_effective_at: assignment.pending_effective_at ?? null,
      },
      feature_keys: [...featureKeys],
      // Only self-serve plans. Operator-assigned ones (`internal`) are not
      // something a vendor can select for themselves.
      available_plans: VENDOR_PLAN_CATALOG.filter(
        (p) => p.is_active && p.is_public
      ).map((p) => ({
        code: p.code,
        display_name: p.display_name,
        description: p.description,
        price_amount: p.price_amount,
        currency_code: p.currency_code,
        interval: p.interval,
        trial_days: p.trial_days,
        display_order: p.display_order,
        feature_keys: p.feature_keys,
      })),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/plan/me] failed", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to load plan",
    })
  }
}
