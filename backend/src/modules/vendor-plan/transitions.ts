/**
 * Plan transition rules — pure functions, no container, no I/O.
 *
 * Follows the `subscription/utils/dunning.ts` precedent: the decisions live
 * here so they can be unit-tested exhaustively, and `service.ts` does only the
 * persistence. Anything that needs the database does NOT belong in this file.
 */

import {
  DEFAULT_PLAN_CODE,
  featureKeysForPlan,
  getPlanDefinition,
  type VendorFeatureKey,
} from "./catalog"
import { VendorPlanStatus } from "./models/vendor-plan-assignment"

/** The subset of an assignment the pure rules need. */
export type AssignmentSnapshot = {
  plan_code: string
  status: VendorPlanStatus
  current_period_end?: Date | null
  cancel_at_period_end?: boolean
  pending_plan_code?: string | null
  pending_effective_at?: Date | null
}

export type PlanChangeKind = "upgrade" | "downgrade" | "lateral" | "noop"

export type PlanTransitionDecision =
  | {
      kind: "immediate"
      change: PlanChangeKind
      to_plan_code: string
      reason: string
    }
  | {
      kind: "deferred"
      change: PlanChangeKind
      to_plan_code: string
      effective_at: Date
      reason: string
    }
  | { kind: "rejected"; reason: string }

/**
 * Rank a plan by price so up/down can be distinguished.
 *
 * Price rather than feature-set size, because a plan can be cheaper while
 * carrying more niche features, and the thing that decides whether a change may
 * apply immediately is whether the seller is paying more or less.
 */
function planRank(code: string): number {
  const def = getPlanDefinition(code)
  if (!def) return -1
  // Normalise yearly prices to a monthly figure so the ladder stays ordered
  // when a plan is billed annually.
  return def.interval === "year" ? def.price_amount / 12 : def.price_amount
}

export function classifyPlanChange(
  fromCode: string,
  toCode: string
): PlanChangeKind {
  if (fromCode === toCode) return "noop"
  const from = planRank(fromCode)
  const to = planRank(toCode)
  if (to > from) return "upgrade"
  if (to < from) return "downgrade"
  return "lateral"
}

/**
 * Decide how a requested plan change should be applied.
 *
 * Upgrades and lateral moves take effect immediately — the seller is paying at
 * least as much and should get what they paid for now. Downgrades are deferred
 * to period end, because revoking mid-period would withdraw features already
 * paid for.
 */
export function decidePlanTransition(args: {
  current: AssignmentSnapshot
  to_plan_code: string
  /** Operator override: apply a downgrade now rather than at period end. */
  immediate?: boolean
  now: Date
}): PlanTransitionDecision {
  const { current, to_plan_code, now } = args

  const target = getPlanDefinition(to_plan_code)
  if (!target) {
    return { kind: "rejected", reason: `unknown plan "${to_plan_code}"` }
  }
  if (!target.is_active) {
    return { kind: "rejected", reason: `plan "${to_plan_code}" is not active` }
  }

  const change = classifyPlanChange(current.plan_code, to_plan_code)
  if (change === "noop") {
    return { kind: "rejected", reason: "already on this plan" }
  }

  if (change === "downgrade" && !args.immediate) {
    // No known period end (free plans, operator-assigned plans) means there is
    // nothing to defer to and nothing already paid for — apply now.
    const effective = current.current_period_end
    if (effective && effective.getTime() > now.getTime()) {
      return {
        kind: "deferred",
        change,
        to_plan_code,
        effective_at: effective,
        reason: "downgrade deferred to end of paid period",
      }
    }
  }

  return {
    kind: "immediate",
    change,
    to_plan_code,
    reason:
      change === "downgrade"
        ? "downgrade applied immediately (no remaining paid period)"
        : `${change} applied immediately`,
  }
}

/**
 * The feature keys a seller should hold, and the delta from what they hold now.
 *
 * Returning a delta rather than "revoke everything, then grant the new set" is
 * deliberate: a blanket cycle would briefly withdraw features the seller keeps
 * across the change, which a concurrent request could observe as a denial.
 */
export function reconcileFeatureKeys(args: {
  plan_code: string
  current_keys: readonly string[]
}): {
  desired: VendorFeatureKey[]
  to_grant: VendorFeatureKey[]
  to_revoke: string[]
} {
  const desired = featureKeysForPlan(args.plan_code)
  const desiredSet = new Set<string>(desired)
  const currentSet = new Set(args.current_keys)

  return {
    desired,
    to_grant: desired.filter((k) => !currentSet.has(k)),
    // Only ever revokes keys in the vendor.* namespace that the plan no longer
    // covers. Keys granted by another mechanism are not this function's to drop,
    // so anything not in `desired` but also not a plan feature is left alone by
    // the caller passing only plan-sourced keys as `current_keys`.
    to_revoke: [...currentSet].filter((k) => !desiredSet.has(k)),
  }
}

/**
 * Advance an assignment to its next billing period.
 *
 * Returns null when the plan does not recur, so callers can skip it rather than
 * inventing a period for a free or operator-assigned plan.
 */
export function applyPeriodRollover(args: {
  plan_code: string
  current_period_end: Date | null | undefined
  now: Date
}): { current_period_start: Date; current_period_end: Date } | null {
  const def = getPlanDefinition(args.plan_code)
  if (!def || def.interval === "none") return null

  // Roll forward from the period that just ended when it is known, so a late
  // cron run does not silently shorten the seller's next period.
  const start =
    args.current_period_end && args.current_period_end.getTime() > 0
      ? new Date(args.current_period_end)
      : new Date(args.now)

  const end = new Date(start)
  if (def.interval === "year") {
    end.setUTCFullYear(end.getUTCFullYear() + 1)
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1)
  }

  return { current_period_start: start, current_period_end: end }
}

/**
 * Is a pending (deferred) plan change ready to apply?
 */
export function isPendingChangeDue(
  assignment: AssignmentSnapshot,
  now: Date
): boolean {
  if (!assignment.pending_plan_code || !assignment.pending_effective_at) {
    return false
  }
  return assignment.pending_effective_at.getTime() <= now.getTime()
}

/**
 * The plan a seller should be on given their assignment state.
 *
 * A canceled assignment falls back to the default plan rather than to "no
 * plan", so entitlements always resolve against a concrete feature set.
 */
export function effectivePlanCode(assignment: AssignmentSnapshot): string {
  if (assignment.status === VendorPlanStatus.CANCELED) {
    return DEFAULT_PLAN_CODE
  }
  return assignment.plan_code
}
