import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { VENDOR_PLAN_MODULE } from "../../../../../modules/vendor-plan"
import type VendorPlanService from "../../../../../modules/vendor-plan/service"
import { getPlanDefinition } from "../../../../../modules/vendor-plan/catalog"
import { VendorPlanAssignedBy } from "../../../../../modules/vendor-plan/models"

const log = createLogger("api/admin/sellers/plan")

type AssignBody = {
  plan_code?: string
  /** Apply a downgrade now rather than at period end. */
  immediate?: boolean
  reason?: string
  idempotency_key?: string
}

/**
 * POST /admin/sellers/:id/plan
 *
 * Operator plan assignment. Unlike the vendor-facing route this may target
 * non-public plans (`internal`) and may force a downgrade to apply immediately,
 * which is what support needs to comp a vendor or correct a mistake.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res.status(400).json({
      type: "invalid_data",
      message: "seller id is required",
    })
  }

  const body = (req.body ?? {}) as AssignBody
  const planCode = typeof body.plan_code === "string" ? body.plan_code.trim() : ""

  if (!planCode) {
    return res.status(400).json({
      type: "invalid_data",
      message: "plan_code is required",
    })
  }

  const definition = getPlanDefinition(planCode)
  if (!definition) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Unknown plan "${planCode}"`,
    })
  }

  try {
    const plans = req.scope.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
    const result = await plans.applyPlanTransition({
      seller_id: sellerId,
      to_plan_code: planCode,
      idempotency_key: body.idempotency_key ?? null,
      assigned_by: VendorPlanAssignedBy.ADMIN,
      immediate: body.immediate ?? false,
      reason: body.reason ?? "assigned by operator",
    })

    if (result.decision.kind === "rejected" && !result.replayed) {
      return res.status(400).json({
        type: "invalid_data",
        message: result.decision.reason,
      })
    }

    return res.json({
      seller_id: sellerId,
      plan: {
        code: result.assignment.plan_code,
        status: result.assignment.status,
        pending_plan_code: result.assignment.pending_plan_code ?? null,
        pending_effective_at: result.assignment.pending_effective_at ?? null,
      },
      applied: result.decision.kind === "immediate",
      deferred: result.decision.kind === "deferred",
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /admin/sellers/:id/plan] failed", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to assign plan",
    })
  }
}
