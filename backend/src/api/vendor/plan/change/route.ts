import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../../shared"
import { createLogger } from "../../../../shared/logger"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import type VendorPlanService from "../../../../modules/vendor-plan/service"
import { getPlanDefinition } from "../../../../modules/vendor-plan/catalog"
import { VendorPlanAssignedBy } from "../../../../modules/vendor-plan/models"

const log = createLogger("api/vendor/plan/change")

type ChangeBody = {
  plan_code?: string
  idempotency_key?: string
}

/**
 * POST /vendor/plan/change
 *
 * Self-serve plan change. Upgrades apply immediately; downgrades are parked
 * until the end of the paid period by `applyPlanTransition`, so the response
 * reports which happened rather than assuming.
 *
 * No payment is taken here — the in-house plan model owns the lifecycle and a
 * charge is a separate concern. Wiring Stripe into this route is deliberately
 * left for the usage-to-invoice work.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = (req.body ?? {}) as ChangeBody
  const planCode = typeof body.plan_code === "string" ? body.plan_code.trim() : ""

  if (!planCode) {
    return res.status(400).json({
      type: "invalid_data",
      message: "plan_code is required",
    })
  }

  const definition = getPlanDefinition(planCode)
  if (!definition || !definition.is_active) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Unknown or inactive plan "${planCode}"`,
    })
  }

  // Operator-assigned plans are not self-selectable — otherwise any vendor
  // could put themselves on the internal all-features plan.
  if (!definition.is_public) {
    return res.status(403).json({
      type: "forbidden",
      message: `Plan "${planCode}" cannot be selected directly`,
    })
  }

  try {
    const plans = req.scope.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
    const result = await plans.applyPlanTransition({
      seller_id: sellerId,
      to_plan_code: planCode,
      idempotency_key: body.idempotency_key ?? null,
      assigned_by: VendorPlanAssignedBy.SELF,
      reason: "self-serve plan change",
    })

    if (result.decision.kind === "rejected" && !result.replayed) {
      return res.status(400).json({
        type: "invalid_data",
        message: result.decision.reason,
      })
    }

    return res.json({
      plan: {
        code: result.assignment.plan_code,
        status: result.assignment.status,
        current_period_end: result.assignment.current_period_end ?? null,
        pending_plan_code: result.assignment.pending_plan_code ?? null,
        pending_effective_at: result.assignment.pending_effective_at ?? null,
      },
      // `deferred` tells the panel to say "takes effect on <date>" rather than
      // implying the change already happened.
      applied: result.decision.kind === "immediate",
      deferred: result.decision.kind === "deferred",
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/plan/change] failed", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to change plan",
    })
  }
}
