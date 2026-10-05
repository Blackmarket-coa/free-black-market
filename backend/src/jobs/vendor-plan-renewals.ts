import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import type VendorPlanService from "../modules/vendor-plan/service"
import {
  applyPeriodRollover,
} from "../modules/vendor-plan/transitions"
import {
  allAccessPlanEnabled,
  getPlanDefinition,
} from "../modules/vendor-plan/catalog"
import { VENDOR_BILLING_MODULE } from "../modules/vendor-billing"
import type VendorBillingService from "../modules/vendor-billing/service"
import {
  VendorChargeKind,
  VendorChargeStatus,
} from "../modules/vendor-billing/charges"
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
  //
  // With FF_ALL_ACCESS_PLAN_V1 on, a pending change onto a priced, recurring
  // plan that does NOT start a trial also raises the new plan's first charge
  // here. Before this, applying it opened a fresh paid period with no charge,
  // and pass 2 below could not see it (its period end had just moved a month
  // out), so the first period on the new plan was never billed (map F8-3).
  // Same charge-first ordering as pass 2: the period is anchored to the
  // recorded `pending_effective_at`, so the charge key
  // `plan:<seller>:<code>:<new period end>` is derived from the record and a
  // crash between the two writes replays instead of double-billing. A change
  // that starts a trial raises nothing here — pass 2 bills it the day the
  // trial ends, as it does for an immediate move. Flag off, this pass is
  // exactly what it was: no charge, period from `now`.
  const billFirstPeriod = allAccessPlanEnabled()
  const duePending = await plans.listDuePendingChanges(now)
  for (const assignment of duePending) {
    const seller_id = assignment.seller_id as string
    try {
      let chargeId: string | null = null
      if (billFirstPeriod) {
        chargeId = await raisePendingChangeCharge(plans, billing, {
          seller_id,
          to_plan_code: assignment.pending_plan_code as string | null,
          effective_at: (assignment.pending_effective_at as Date | null) ?? null,
          now,
        })
      }

      const applied = billFirstPeriod
        ? await plans.applyPendingChange(seller_id, now, {
            anchor_to_effective_at: true,
          })
        : await plans.applyPendingChange(seller_id, now)
      if (applied) {
        invalidateSellerPlan(seller_id)
        if (chargeId) {
          const execution = await executeCharge(container, chargeId)
          outcomes.push({
            seller_id,
            action: "pending_applied",
            charge_status: String(execution.status),
          })
        } else {
          outcomes.push({ seller_id, action: "pending_applied" })
        }
      } else if (chargeId) {
        // Listed as due but no longer applicable (superseded between the
        // list and the apply). The charge was for a period that will not
        // start — void it rather than leave it owed.
        await billing.transitionCharge(chargeId, VendorChargeStatus.VOID, {
          failure_reason: "pending plan change no longer applicable",
        })
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
    pending_plan_code?: string | null
    pending_effective_at?: Date | null
  }[]

  for (const assignment of dueRenewals) {
    const seller_id = assignment.seller_id
    try {
      if (assignment.status !== "active" && assignment.status !== "trialing") {
        continue
      }
      // Flag on: an assignment still carrying a DUE pending change is one
      // whose pass-1 apply failed this run. Renewing it here would bill the
      // plan the seller is leaving (e.g. $249 scale on the day they move to
      // $10 all_access); skip it and let the next run apply the change and
      // raise the right first charge. Flag off, unchanged (the old plan
      // renews — a pre-existing hazard left as it was).
      if (
        billFirstPeriod &&
        assignment.pending_plan_code &&
        assignment.pending_effective_at &&
        new Date(assignment.pending_effective_at).getTime() <= now.getTime()
      ) {
        outcomes.push({ seller_id, action: "skipped" })
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

/**
 * Record the first charge for a pending change onto a priced, recurring plan
 * that starts no trial. Returns the charge id, or null when nothing is owed
 * (free/operator plan, a trial, an unknown plan). Idempotent from the record:
 * the period runs from `pending_effective_at`, so every retry derives the
 * same key and `createCharge` replays it.
 */
async function raisePendingChangeCharge(
  plans: VendorPlanService,
  billing: VendorBillingService,
  args: {
    seller_id: string
    to_plan_code: string | null
    effective_at: Date | null
    now: Date
  }
): Promise<string | null> {
  if (!args.to_plan_code || !args.effective_at) return null
  const definition = getPlanDefinition(args.to_plan_code)
  if (!definition || definition.interval === "none") return null
  if (definition.price_amount <= 0) return null

  const trialEndsAt = await plans.trialEndsAtForChange(
    args.seller_id,
    args.to_plan_code,
    args.now
  )
  if (trialEndsAt) return null

  const period = applyPeriodRollover({
    plan_code: args.to_plan_code,
    current_period_end: new Date(args.effective_at),
    now: args.now,
  })
  if (!period) return null

  const { charge } = await billing.createCharge({
    seller_id: args.seller_id,
    kind: VendorChargeKind.PLAN,
    amount: definition.price_amount,
    currency_code: definition.currency_code,
    description: `${definition.display_name} plan`,
    discriminator: `${args.to_plan_code}:${period.current_period_end.toISOString()}`,
    period_start: period.current_period_start,
    period_end: period.current_period_end,
  })
  return charge.id
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
