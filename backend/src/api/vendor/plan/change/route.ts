import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../../shared"
import { createLogger } from "../../../../shared/logger"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import type VendorPlanService from "../../../../modules/vendor-plan/service"
import { getPlanDefinition } from "../../../../modules/vendor-plan/catalog"
import { VendorPlanAssignedBy } from "../../../../modules/vendor-plan/models"
import { VENDOR_BILLING_MODULE } from "../../../../modules/vendor-billing"
import type VendorBillingService from "../../../../modules/vendor-billing/service"
import {
  VendorChargeKind,
  proratedAmount,
} from "../../../../modules/vendor-billing/charges"
import { executeCharge } from "../../../../shared/vendor-charge-execution"

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

    // Charge for an immediate upgrade to a paid plan. Recorded after the
    // transition (access first, collection second — the reverse would gate an
    // upgrade on Stripe uptime) and never allowed to fail the plan change:
    // an uncollected charge sits in the vendor's balance, which is exactly
    // what the ledger is for. Prorated to the remaining period so a
    // mid-period upgrade never bills a full month for four days. Downgrades
    // are deferred to period end and charge nothing here.
    let charge_status: string | null = null
    if (
      result.decision.kind === "immediate" &&
      !result.replayed &&
      definition.price_amount > 0
    ) {
      try {
        const billing = req.scope.resolve<VendorBillingService>(
          VENDOR_BILLING_MODULE
        )
        const periodStart = result.assignment.current_period_start
          ? new Date(result.assignment.current_period_start)
          : new Date()
        const periodEnd = result.assignment.current_period_end
          ? new Date(result.assignment.current_period_end)
          : null
        const amount = periodEnd
          ? proratedAmount({
              fullAmount: definition.price_amount,
              periodStart,
              periodEnd,
              from: new Date(),
            })
          : definition.price_amount

        if (amount > 0) {
          const { charge } = await billing.createCharge({
            seller_id: sellerId,
            kind: VendorChargeKind.PLAN,
            amount,
            currency_code: definition.currency_code,
            description: `${definition.display_name} plan`,
            // One charge per plan-period pair: retrying the same upgrade in
            // the same period replays, a renewal next period gets a new key.
            discriminator: `${planCode}:${periodEnd?.toISOString() ?? "initial"}`,
            period_start: periodStart,
            period_end: periodEnd,
          })
          const execution = await executeCharge(req.scope, charge.id)
          charge_status = execution.status as string
        }
      } catch (chargeError) {
        log.warn(
          `[plan/change] charge failed for ${sellerId} -> ${planCode}; plan applied, balance outstanding`,
          chargeError
        )
      }
    }

    return res.json({
      charge_status,
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
