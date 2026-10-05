import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../../shared"
import { createLogger } from "../../../../shared/logger"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import type VendorPlanService from "../../../../modules/vendor-plan/service"
import {
  allAccessPlanEnabled,
  getPlanDefinition,
  isPlanOffered,
} from "../../../../modules/vendor-plan/catalog"
import { VendorPlanAssignedBy, VendorPlanStatus } from "../../../../modules/vendor-plan/models"
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
  /**
   * The vendor's affirmative approval that a priced plan renews every period
   * until cancelled. Required (must be literally `true`) for a priced plan
   * while FF_ALL_ACCESS_PLAN_V1 is on; ignored otherwise.
   */
  auto_renew_consent?: unknown
}

/**
 * The key a vendor's idempotency key is stored under. Plan-event keys are
 * unique across ALL sellers (`IDX_vendor_plan_event_idem` is on the key
 * alone), so a client key used verbatim let one vendor's request claim
 * another's: two vendors who sent the same key got one transition, and the
 * second a silent `replayed: true` with no change. Prefixing the seller makes
 * a replay mean "this seller already sent this", which is all it should mean.
 */
function scopedIdempotencyKey(
  sellerId: string,
  key: unknown
): string | null {
  if (typeof key !== "string" || !key.trim()) return null
  return `vendor:${sellerId}:${key.trim()}`
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
  // could put themselves on the internal all-features plan. Nor is a plan the
  // current ladder does not offer: with FF_ALL_ACCESS_PLAN_V1 on, the retired
  // starter/pro/scale tiers; with it off, all_access. Both refusals return the
  // same body, so the response says nothing about which rows exist behind it.
  if (!definition.is_public || !isPlanOffered(planCode)) {
    return res.status(403).json({
      type: "forbidden",
      message: `Plan "${planCode}" cannot be selected directly`,
    })
  }

  // "Renew upon approval": with FF_ALL_ACCESS_PLAN_V1 on, a recurring plan is
  // started only on the vendor's affirmative approval of its renewal, and that
  // approval is recorded on the transition's event row. The panel's confirm
  // step (which states price, trial and renewal) is what sends it. Flag off,
  // the route is unchanged.
  const requiresConsent =
    allAccessPlanEnabled() &&
    definition.price_amount > 0 &&
    definition.interval !== "none"
  if (requiresConsent && body.auto_renew_consent !== true) {
    return res.status(400).json({
      type: "invalid_data",
      message:
        "auto_renew_consent must be true: this plan renews every period until you cancel",
    })
  }

  try {
    const plans = req.scope.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
    const result = await plans.applyPlanTransition({
      seller_id: sellerId,
      to_plan_code: planCode,
      idempotency_key: scopedIdempotencyKey(sellerId, body.idempotency_key),
      assigned_by: VendorPlanAssignedBy.SELF,
      reason: "self-serve plan change",
      ...(requiresConsent
        ? {
            event_payload: {
              auto_renew_consent: true,
              auto_renew_consent_at: new Date().toISOString(),
            },
          }
        : {}),
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
    // A trialing assignment bills nothing now. The first charge is raised by
    // the renewal job on the day the trial ends, which is what the assignment's
    // first period end is set to — so a plan that advertises a free trial
    // delivers one instead of taking the full amount on signup.
    const isTrialing = result.assignment.status === VendorPlanStatus.TRIALING
    if (
      result.decision.kind === "immediate" &&
      !result.replayed &&
      !isTrialing &&
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
