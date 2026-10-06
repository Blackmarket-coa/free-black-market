import type { FeeSchedulePlan } from "../data/fee-schedule"
import { processingCopy, type ProcessingInfo } from "./processing-copy"

/**
 * Plan-ladder prose rendered from `/store/fee-schedule` rather than hardcoded.
 *
 * The sell page and how-it-works used to spell the ladder out by hand
 * ("Starter $29/mo for 2.5%, Pro $99/mo for 2%, Scale $249/mo for 1.5%"). That
 * copy cannot follow the catalog: when FF_ALL_ACCESS_PLAN_V1 retires those
 * tiers for the $10 all-access plan, the hand-written sentence would keep
 * selling plans nobody can buy. These functions build the same sentences from
 * the plans the backend actually offers. Fed today's schedule they return
 * today's sentences character for character (pinned in
 * `__tests__/fee-ladder-copy.spec.ts`).
 *
 * If the schedule could not be fetched (`plans: []`) the clauses degrade to
 * the generic "paid plans are optional and lower the rate" with no numbers —
 * saying nothing specific is better than quoting a stale price.
 */

export type LadderPlan = Pick<
  FeeSchedulePlan,
  | "display_name"
  | "price_amount"
  | "currency_code"
  | "interval"
  | "platform_fee_percent"
  | "is_default"
> & { trial_days?: number }

const paidPlans = <T extends LadderPlan>(plans: readonly T[]): T[] =>
  plans.filter((p) => !p.is_default && p.price_amount > 0)

/** "$29/mo", "$10/mo", "$29.50/mo", "$120/yr". Integer cents in, no float drift out. */
export function formatPlanPrice(plan: LadderPlan): string {
  const cents = Math.round(plan.price_amount)
  const whole = Math.floor(cents / 100)
  const rest = cents % 100
  const amount = rest === 0 ? `${whole}` : `${whole}.${String(rest).padStart(2, "0")}`
  const money =
    (plan.currency_code || "usd").toLowerCase() === "usd"
      ? `$${amount}`
      : `${amount} ${plan.currency_code.toUpperCase()}`
  const suffix = plan.interval === "month" ? "/mo" : plan.interval === "year" ? "/yr" : ""
  return `${money}${suffix}`
}

/** "a", "a or b", "a, b or c". */
export function joinWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`
}

/** "a", "a and b", "a, b and c". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/**
 * "Paid plans are optional and lower the rate: Starter $29/mo for 2.5%, …"
 * One paid plan reads in the singular; none reads with no ladder at all.
 */
export function paidPlansSentence(plans: readonly LadderPlan[]): string {
  const paid = paidPlans(plans)
  if (paid.length === 0) return "Paid plans are optional and lower the rate."
  const ladder = paid
    .map((p) => `${p.display_name} ${formatPlanPrice(p)} for ${p.platform_fee_percent}%`)
    .join(", ")
  return paid.length === 1
    ? `A paid plan is optional and lowers the rate: ${ladder}.`
    : `Paid plans are optional and lower the rate: ${ladder}.`
}

/**
 * The trial sentence the sell page printed before the copy was data-driven.
 * Used only when the schedule carries no `trial_days` at all — which is what
 * the backend sends with FF_ALL_ACCESS_PLAN_V1 off, keeping that response
 * byte-identical — and only while both plans it names are still offered, so
 * a retired tier cannot leave it behind.
 */
const LEGACY_TRIAL_PLANS = ["Starter", "Pro"] as const
const LEGACY_TRIAL_SENTENCE = `${LEGACY_TRIAL_PLANS.join(" and ")} include a 30-day free trial.`

/**
 * "All-Access includes a 30-day free trial." — from each plan's `trial_days`
 * when the schedule states them (flag on). When no plan states one (flag off),
 * the sentence the page always printed, provided Starter and Pro are both
 * still offered. Empty when no paid plan carries a trial, so callers can
 * append it unconditionally.
 */
export function trialSentence(plans: readonly LadderPlan[]): string {
  if (plans.length > 0 && plans.every((p) => p.trial_days === undefined)) {
    const offered = new Set(paidPlans(plans).map((p) => p.display_name))
    return LEGACY_TRIAL_PLANS.every((name) => offered.has(name))
      ? LEGACY_TRIAL_SENTENCE
      : ""
  }
  const byDays = new Map<number, string[]>()
  for (const p of paidPlans(plans)) {
    const days = p.trial_days ?? 0
    if (days <= 0) continue
    byDays.set(days, [...(byDays.get(days) ?? []), p.display_name])
  }
  return [...byDays.entries()]
    .map(
      ([days, names]) =>
        `${joinWithAnd(names)} ${names.length > 1 ? "include" : "includes"} a ${days}-day free trial.`
    )
    .join(" ")
}

/**
 * "optional paid plans bring it to 2.5%, 2% or 1.5%" — the rates alone, for
 * prose that has already named the default. Empty when nothing is offered.
 */
export function paidRatesClause(plans: readonly LadderPlan[]): string {
  const paid = paidPlans(plans)
  if (paid.length === 0) return ""
  const rates = joinWithOr(paid.map((p) => `${p.platform_fee_percent}%`))
  return paid.length === 1
    ? `an optional paid plan brings it to ${rates}`
    : `optional paid plans bring it to ${rates}`
}

/**
 * The sell page's "How much does it cost to join?" answer. `processing` is
 * `/store/fee-schedule`'s processing model (Black Mask F6); absent, the lead
 * sentence is today's exactly.
 */
export function sellPageCostAnswer(
  plans: readonly LadderPlan[],
  processing?: ProcessingInfo,
  feePercent = 3
): string {
  const trial = trialSentence(plans)
  return [
    processingCopy("sellCostLead", processing, feePercent),
    paidPlansSentence(plans),
    ...(trial ? [trial] : []),
  ].join(" ")
}

/** How-it-works' "Just 3% Coalition Fee" card body (processing model as above). */
export function howItWorksFeeDescription(
  plans: readonly LadderPlan[],
  processing?: ProcessingInfo,
  feePercent = 3
): string {
  const rates = paidRatesClause(plans)
  return `${processingCopy("howItWorksFeeLead", processing, feePercent)}${
    rates ? ` — ${rates}` : ""
  }.`
}
