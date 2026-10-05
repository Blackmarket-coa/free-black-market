import type {
  AvailablePlan,
  VendorPlanChangePreview,
  VendorPlanChangeResponse,
} from "../../../hooks/api/vendor-plan"

/**
 * Pure text and key helpers for the plan picker, kept free of UI imports so
 * they are unit-tested directly (`plan-terms.spec.ts`).
 */

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format(amount / 100)

/** "Nov 1, 2026" — fixed locale and UTC, so the same instant reads the same everywhere. */
export const formatPlanDate = (iso: string | null | undefined): string | null =>
  iso
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(iso))
    : null

type PriceFields = Pick<
  AvailablePlan,
  "price_amount" | "currency_code" | "interval"
>

/** "$10.00/month", or "Free" for a plan with no recurring price. */
export function describePlanPrice(plan: PriceFields): string {
  if (plan.price_amount <= 0 || plan.interval === "none") return "Free"
  return `${money(plan.price_amount, plan.currency_code)}/${plan.interval}`
}

/**
 * The terms a vendor agrees to by confirming, built from the per-seller
 * preview: when the change lands, the trial they will actually get, what is
 * charged today, when the first recurring charge is raised, and that it renews
 * until cancelled. A recurring charge the vendor was not told about up front
 * is not a charge they agreed to.
 */
export function describeChangeTerms(preview: VendorPlanChangePreview): string {
  const parts: string[] = []
  const effective = formatPlanDate(preview.effective_at)

  if (preview.deferred) {
    parts.push(
      `Takes effect on ${effective ?? "the end of your current period"}. You keep your current plan until then.`
    )
  }

  if (!preview.renews) {
    parts.push(
      preview.deferred
        ? "No monthly charge after that."
        : "No monthly charge. Takes effect now."
    )
    return parts.join(" ")
  }

  const price = describePlanPrice(preview)
  const firstCharge = formatPlanDate(preview.first_charge_at)

  if (preview.trial_days > 0) {
    parts.push(
      `${preview.trial_days}-day free trial${
        preview.deferred ? " from that date" : ""
      }, then ${price}. First charge on ${
        formatPlanDate(preview.trial_ends_at) ?? firstCharge ?? "the day the trial ends"
      }.`
    )
  } else if (preview.charge_now_amount > 0) {
    parts.push(
      `No free trial. ${money(
        preview.charge_now_amount,
        preview.currency_code
      )} is charged today, then ${price}.`
    )
  } else {
    parts.push(
      `No free trial. ${price}, first charged on ${
        firstCharge ?? effective ?? "the day it takes effect"
      }.`
    )
  }

  parts.push(
    `Renews every ${preview.interval} until you cancel; cancelling keeps the plan to the end of the period already paid for.`
  )
  return parts.join(" ")
}

export type ChangeOutcome =
  | { kind: "deferred"; message: string }
  | { kind: "trial"; message: string }
  | { kind: "moved"; message: string }
  | { kind: "unchanged"; message: string }

/**
 * What the change response means for the vendor. A replayed key, or a response
 * that neither applied nor deferred anything, is NOT a success — saying
 * "Moved to X" there would tell a vendor still on free (and still paying 3%)
 * that they had moved.
 */
export function changeOutcome(
  displayName: string,
  result: VendorPlanChangeResponse
): ChangeOutcome {
  if (result.replayed || (!result.applied && !result.deferred)) {
    return {
      kind: "unchanged",
      message: "No change was made to your plan. Refresh and try again.",
    }
  }
  if (result.deferred) {
    const when = formatPlanDate(result.plan.pending_effective_at)
    return {
      kind: "deferred",
      message: `${displayName} takes effect on ${
        when ?? "the end of your current period"
      }. You keep your current plan until then.`,
    }
  }
  if (result.plan.status === "trialing") {
    return { kind: "trial", message: `${displayName} trial started` }
  }
  return { kind: "moved", message: `Moved to ${displayName}` }
}

/**
 * One idempotency key per confirm attempt, made when the confirm step opens.
 * A double-click on Confirm reuses it (and replays); re-opening the step makes
 * a new one. Never derived from the plan or the date: such a key is the same
 * for every vendor that day (the backend also scopes keys by seller).
 */
export function newPanelIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const id =
    typeof c?.randomUUID === "function"
      ? c.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
          .toString(36)
          .slice(2)}`
  return `panel:${id}`
}
