import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import type VendorPlanService from "../modules/vendor-plan/service"
import {
  applyPeriodRollover,
} from "../modules/vendor-plan/transitions"
import { getPlanDefinition } from "../modules/vendor-plan/catalog"
import { VENDOR_BILLING_MODULE } from "../modules/vendor-billing"
import type VendorBillingService from "../modules/vendor-billing/service"
import { VendorChargeKind } from "../modules/vendor-billing/charges"
import { executeCharge } from "../shared/vendor-charge-execution"
import { invalidateSellerPlan } from "../shared/plan-entitlement-cache"

const log = createLogger("jobs/vendor-plan-renewals")

export type RenewalOutcome = {
  seller_id: string
  action: "pending_applied" | "renewed" | "skipped" | "failed"
  charge_status?: string
  error?: string
}

/**
 * The hourly heartbeat of plan billing. Two passes, both driving machinery the
 * plan module has carried since #765 with nothing to turn the crank:
 *
 *   1. Apply due pending changes — the deferred downgrades that
 *      `applyPlanTransition` scheduled for period end.
 *   2. Roll expired periods on recurring paid plans, and raise the new
 *      period's charge.
 *
 * **The charge is recorded BEFORE the period is rolled.** The new period's end
 * is computable in advance (`applyPeriodRollover` is pure), so the charge's
 * idempotency key — `plan:<seller>:<code>:<new period end>` — is stable across
 * the two writes. Ordered this way, every crash point recovers: charge
 * written + roll failed → next run recomputes the same period, the charge
 * replays, the roll retries. Rolled first instead, a crash between the two
 * would drop the assignment out of the due-list with the period's charge
 * never raised — silently free service, and nothing would ever notice.
 *
 * Collection (`executeCharge`) runs after the roll and is best-effort: with
 * billing unconfigured or no saved payment method the charge simply stays
 * pending in the vendor's balance. Moving a vendor to `past_due`/dunning off
 * repeated failures is deliberately NOT here yet — that decision should reuse
 * `decideDunningAction` and deserves its own change, not a side effect of the
 * renewal loop.
 *
 * Each seller is processed in its own try/catch so one bad row cannot abort
 * the batch (the `demand-pool-expiry` pattern). Exported for unit tests; the
 * default export is the cron shell.
 */
export async function processPlanRenewals(
  container: MedusaContainer,
  now: Date = new Date()
): Promise<RenewalOutcome[]> {
  const plans = container.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
  const billing = container.resolve<VendorBillingService>(VENDOR_BILLING_MODULE)
  const outcomes: RenewalOutcome[] = []

  // Pass 1: deferred downgrades whose effective date has arrived.
  const duePending = await plans.listDuePendingChanges(now)
  for (const assignment of duePending) {
    const seller_id = assignment.seller_id as string
    try {
      const applied = await plans.applyPendingChange(seller_id, now)
      if (applied) {
        invalidateSellerPlan(seller_id)
        outcomes.push({ seller_id, action: "pending_applied" })
      }
    } catch (err) {
      outcomes.push({
        seller_id,
        action: "failed",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Pass 2: expired periods on recurring plans.
  const dueRenewals = (await plans.listVendorPlanAssignments({
    current_period_end: { $lte: now },
  } as Record<string, unknown>)) as unknown as {
    id: string
    seller_id: string
    plan_code: string
    status: string
    current_period_end: Date | null
  }[]

  for (const assignment of dueRenewals) {
    const seller_id = assignment.seller_id
    try {
      if (assignment.status !== "active" && assignment.status !== "trialing") {
        continue
      }
      const definition = getPlanDefinition(assignment.plan_code)
      if (!definition || definition.interval === "none") {
        // Free and operator plans have no period to renew; a stale
        // period_end on one is leftover state, not a bill.
        continue
      }

      const rolled = applyPeriodRollover({
        plan_code: assignment.plan_code,
        current_period_end: assignment.current_period_end
          ? new Date(assignment.current_period_end)
          : null,
        now,
      })
      if (!rolled) {
        outcomes.push({ seller_id, action: "skipped" })
        continue
      }

      let chargeId: string | null = null
      let charge_status: string | undefined
      if (definition.price_amount > 0) {
        const { charge } = await billing.createCharge({
          seller_id,
          kind: VendorChargeKind.PLAN,
          amount: definition.price_amount,
          currency_code: definition.currency_code,
          description: `${definition.display_name} plan renewal`,
          discriminator: `${assignment.plan_code}:${rolled.current_period_end.toISOString()}`,
          period_start: rolled.current_period_start,
          period_end: rolled.current_period_end,
        })
        chargeId = charge.id
        charge_status = charge.status
      }

      await plans.rollPeriod(seller_id, now)
      invalidateSellerPlan(seller_id)

      if (chargeId) {
        const execution = await executeCharge(container, chargeId)
        charge_status = String(execution.status)
      }

      outcomes.push({ seller_id, action: "renewed", charge_status })
    } catch (err) {
      outcomes.push({
        seller_id,
        action: "failed",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return outcomes
}

export default async function vendorPlanRenewals(container: MedusaContainer) {
  const outcomes = await processPlanRenewals(container)
  const failed = outcomes.filter((o) => o.action === "failed")
  if (outcomes.length) {
    log.info(
      `[plan-renewals] processed ${outcomes.length}: ` +
        `${outcomes.filter((o) => o.action === "pending_applied").length} pending applied, ` +
        `${outcomes.filter((o) => o.action === "renewed").length} renewed, ` +
        `${failed.length} failed`
    )
  }
  for (const f of failed) {
    log.warn(`[plan-renewals] ${f.seller_id}: ${f.error}`)
  }
}

export const config = {
  name: "vendor-plan-renewals",
  schedule: "0 * * * *",
}
