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
import { applyPeriodRollover } from "../../../../modules/vendor-plan/transitions"

const log = createLogger("api/vendor/plan/preview")

const iso = (d: Date | null) => (d ? d.toISOString() : null)

/**
 * GET /vendor/plan/preview?plan_code=<code>
 *
 * What `POST /vendor/plan/change` would do for THIS seller if they confirmed
 * now — read-only. The panel's confirm step renders the terms from this, so the
 * one disclosure in front of a recurring charge says what will actually happen:
 *
 * - `deferred` / `effective_at`: a move to a cheaper plan lands at the end of
 *   the period already paid for, not today.
 * - `trial_days` / `trial_ends_at`: the trial this seller would actually get.
 *   all_access trials once per seller, so a returning vendor sees 0, not the
 *   catalog's 30.
 * - `charge_now_amount` (integer cents): what confirming charges today.
 * - `first_charge_at`: when the first recurring charge is raised.
 *
 * Same gating, in the same order and with the same bodies, as the change route
 * (an unknown plan is 400; an operator-only or not-offered plan is the same
 * 403), so the preview cannot describe a plan the change route would refuse.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const raw = (req.query ?? {}) as Record<string, unknown>
  const planCode = typeof raw.plan_code === "string" ? raw.plan_code.trim() : ""
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
  if (!definition.is_public || !isPlanOffered(planCode)) {
    return res.status(403).json({
      type: "forbidden",
      message: `Plan "${planCode}" cannot be selected directly`,
    })
  }

  try {
    const plans = req.scope.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
    const now = new Date()
    const { decision, trial_ends_at } = await plans.previewPlanChange(
      sellerId,
      planCode,
      now
    )

    if (decision.kind === "rejected") {
      return res.status(400).json({
        type: "invalid_data",
        message: decision.reason,
      })
    }

    const deferred = decision.kind === "deferred"
    const effectiveAt = deferred ? decision.effective_at : null
    const recurring =
      definition.price_amount > 0 && definition.interval !== "none"

    let charge_now_amount = 0
    let first_charge_at: Date | null = null
    if (recurring) {
      if (trial_ends_at) {
        // Trial first, wherever it starts: the renewal job bills on its end.
        first_charge_at = trial_ends_at
      } else if (!deferred) {
        // An immediate move opens a fresh period from now, and the change
        // route bills it on the spot (prorated over a period that starts now,
        // so the whole price).
        charge_now_amount = definition.price_amount
        first_charge_at = now
      } else if (allAccessPlanEnabled()) {
        // Flag on, the renewal job raises the first charge the day a deferred
        // move lands (map F8-3).
        first_charge_at = effectiveAt
      } else {
        // Flag off the job, unchanged, opens the first period unbilled and
        // raises the first charge when that period ends. Stated as it is.
        first_charge_at =
          applyPeriodRollover({
            plan_code: planCode,
            current_period_end: effectiveAt,
            now,
          })?.current_period_end ?? effectiveAt
      }
    }

    return res.json({
      plan_code: definition.code,
      display_name: definition.display_name,
      price_amount: definition.price_amount,
      currency_code: definition.currency_code,
      interval: definition.interval,
      change: decision.change,
      deferred,
      effective_at: iso(effectiveAt),
      trial_days: trial_ends_at ? definition.trial_days : 0,
      trial_ends_at: iso(trial_ends_at),
      charge_now_amount,
      first_charge_at: iso(first_charge_at),
      renews: recurring,
      // Whether `POST /vendor/plan/change` will require `auto_renew_consent`.
      requires_auto_renew_consent: recurring && allAccessPlanEnabled(),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/plan/preview] failed", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to preview plan change",
    })
  }
}
