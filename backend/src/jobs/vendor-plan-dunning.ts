import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import {
  decideDunningAction,
} from "../modules/subscription/utils/dunning"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import type VendorPlanService from "../modules/vendor-plan/service"
import {
  VendorPlanAssignedBy,
  VendorPlanStatus,
} from "../modules/vendor-plan/models/vendor-plan-assignment"
import { VENDOR_BILLING_MODULE } from "../modules/vendor-billing"
import type VendorBillingService from "../modules/vendor-billing/service"
import type { ChargeRecord } from "../modules/vendor-billing/service"
import {
  VendorChargeKind,
  VendorChargeStatus,
} from "../modules/vendor-billing/charges"
import { executeCharge } from "../shared/vendor-charge-execution"
import { invalidateSellerPlan } from "../shared/plan-entitlement-cache"

const log = createLogger("jobs/vendor-plan-dunning")

export type DunningOutcome = {
  seller_id: string
  charge_id: string
  action:
    | "retry_scheduled"
    | "recovered"
    | "collecting"
    | "paused_to_free"
    | "waiting"
    | "skipped"
    | "failed"
  attempts?: number
  next_retry_at?: Date
  error?: string
}

/**
 * What happens after a plan charge fails — the loop the renewal cron
 * deliberately left out.
 *
 * Reuses `decideDunningAction` from the subscription module verbatim (it is
 * pure, so no import cycle): up to 3 attempts on a 1/3/7-day backoff, then
 * pause. Mapped onto plans exactly as Phase 0 specified:
 *
 *   retry → the assignment goes `past_due` and KEEPS its features. The vendor
 *           paid for everything up to now; a card that expired over the
 *           weekend is not grounds for yanking their POS mid-market-day.
 *   pause → after the attempts are exhausted, an immediate drop to `free`
 *           through the ordinary `applyPlanTransition` funnel (so it is
 *           evented, idempotent, and reconciles entitlements like any other
 *           transition), and the unpaid charge is VOIDED — the platform does
 *           not keep chasing money for a plan it just revoked. The failure
 *           history stays on the voided charge for support.
 *
 * Recovery is the inverse: when a due retry collects (or a vendor pays after
 * adding a card), `past_due` returns to `active` and the counters reset.
 *
 * One decision per wake per charge, each seller in its own try/catch. The
 * schedule offsets the renewal cron by 30 minutes so a fresh renewal failure
 * gets its first dunning decision within the hour without the two jobs
 * interleaving on the same rows.
 */
export async function processDunning(
  container: MedusaContainer,
  now: Date = new Date()
): Promise<DunningOutcome[]> {
  const plans = container.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
  const billing = container.resolve<VendorBillingService>(VENDOR_BILLING_MODULE)
  const outcomes: DunningOutcome[] = []

  const failedCharges = (await billing.listVendorCharges({
    kind: VendorChargeKind.PLAN,
    status: VendorChargeStatus.FAILED,
  })) as unknown as ChargeRecord[]

  for (const charge of failedCharges) {
    const seller_id = charge.seller_id
    try {
      const assignment = (await plans.getAssignment(seller_id)) as {
        id: string
        plan_code: string
        status: string
        dunning_attempts: number | null
        next_retry_at: Date | string | null
      } | null

      if (
        !assignment ||
        assignment.status === VendorPlanStatus.CANCELED ||
        assignment.plan_code === "free"
      ) {
        // Already off the paid plan (canceled, or a previous pause dropped
        // them). The stale charge is voided so it stops surfacing here and in
        // the vendor's outstanding balance.
        await billing.transitionCharge(charge.id, VendorChargeStatus.VOID)
        outcomes.push({ seller_id, charge_id: charge.id, action: "skipped" })
        continue
      }

      const nextRetryAt = assignment.next_retry_at
        ? new Date(assignment.next_retry_at)
        : null

      // A scheduled retry that is not due yet: nothing to do this wake.
      if (nextRetryAt && nextRetryAt.getTime() > now.getTime()) {
        outcomes.push({ seller_id, charge_id: charge.id, action: "waiting" })
        continue
      }

      // A due retry: present the charge again before deciding anything.
      // (First-time failures have no next_retry_at and skip straight to the
      // decision — the renewal cron already made their first attempt.)
      if (nextRetryAt) {
        const execution = await executeCharge(container, charge.id)
        if (
          execution.status === VendorChargeStatus.PAID ||
          execution.status === VendorChargeStatus.PROCESSING
        ) {
          await plans.updateVendorPlanAssignments([
            {
              id: assignment.id,
              status: VendorPlanStatus.ACTIVE,
              dunning_attempts: 0,
              next_retry_at: null,
            },
          ])
          invalidateSellerPlan(seller_id)
          outcomes.push({
            seller_id,
            charge_id: charge.id,
            action:
              execution.status === VendorChargeStatus.PAID
                ? "recovered"
                : "collecting",
          })
          continue
        }
      }

      const attempts = (assignment.dunning_attempts ?? 0) + 1
      const decision = decideDunningAction({
        attempts,
        now,
        error: charge.failure_reason,
      })

      if (decision.kind === "retry") {
        await plans.updateVendorPlanAssignments([
          {
            id: assignment.id,
            status: VendorPlanStatus.PAST_DUE,
            dunning_attempts: attempts,
            next_retry_at: decision.next_retry_at,
          },
        ])
        invalidateSellerPlan(seller_id)
        outcomes.push({
          seller_id,
          charge_id: charge.id,
          action: "retry_scheduled",
          attempts,
          next_retry_at: decision.next_retry_at,
        })
        continue
      }

      // Attempts exhausted: drop to free through the ordinary transition
      // funnel — evented, idempotent, entitlements reconciled like any other
      // change. `immediate` because a dunning drop deferred to period end
      // would be free service until then, which is what pausing exists to end.
      await plans.applyPlanTransition({
        seller_id,
        to_plan_code: "free",
        immediate: true,
        assigned_by: VendorPlanAssignedBy.SYSTEM,
        reason: decision.reason,
        idempotency_key: `dunning:${assignment.id}:${charge.id}`,
      })
      await plans.updateVendorPlanAssignments([
        { id: assignment.id, dunning_attempts: 0, next_retry_at: null },
      ])
      // Stop collecting for a plan that was just revoked. The failure history
      // stays on the voided row for support.
      await billing.transitionCharge(charge.id, VendorChargeStatus.VOID)
      invalidateSellerPlan(seller_id)
      outcomes.push({
        seller_id,
        charge_id: charge.id,
        action: "paused_to_free",
        attempts,
      })
    } catch (err) {
      outcomes.push({
        seller_id,
        charge_id: charge.id,
        action: "failed",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return outcomes
}

export default async function vendorPlanDunning(container: MedusaContainer) {
  const outcomes = await processDunning(container)
  const acted = outcomes.filter(
    (o) => o.action !== "waiting" && o.action !== "skipped"
  )
  if (acted.length) {
    log.info(
      `[plan-dunning] ${acted.length} acted on: ` +
        `${acted.filter((o) => o.action === "retry_scheduled").length} retries scheduled, ` +
        `${acted.filter((o) => o.action === "recovered" || o.action === "collecting").length} recovered, ` +
        `${acted.filter((o) => o.action === "paused_to_free").length} paused to free, ` +
        `${acted.filter((o) => o.action === "failed").length} errored`
    )
  }
  for (const f of outcomes.filter((o) => o.action === "failed")) {
    log.warn(`[plan-dunning] ${f.seller_id} (${f.charge_id}): ${f.error}`)
  }
}

export const config = {
  name: "vendor-plan-dunning",
  schedule: "30 * * * *",
}
