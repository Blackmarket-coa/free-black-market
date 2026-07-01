import type { VendorSubstrate } from "../types"

/**
 * The universal honest-UI disclaimer, specialized per gatekeeper. Every quest
 * surface and every packet must show a variant of this: FBM assembles
 * documentation from the vendor's real history; the named gatekeeper is the
 * actual decision-maker; official forms and humans are the real gate.
 */
export function disclaimer(gatekeeper: string): string {
  return (
    `FBM assembles this documentation from your real operating history on the ` +
    `platform. It does not guarantee any outcome and does not fabricate ` +
    `records. ${gatekeeper} is the decision-maker; official forms and their ` +
    `review are the actual gate. Verify every figure before submitting.`
  )
}

/**
 * The wellness/health-claims guardrail statement, appended to any wellness
 * product or practitioner quest. Documents verified credentials ONLY; never
 * implies clinical authority or licensure beyond what was actually verified.
 */
export const WELLNESS_GUARDRAIL =
  `This record documents regulatory requirements and only the credentials you ` +
  `uploaded that were verified. It makes no health, therapeutic, or ` +
  `disease-treatment claims and does not imply clinical authority or licensure ` +
  `beyond what has been verified.`

// ── Small reusable substrate predicates (config helpers, not engine logic) ──

export const monthsActiveAtLeast = (n: number) => (s: VendorSubstrate) =>
  s.operating.months_active >= n

export const lifetimeRevenueAtLeast = (amount: number) => (s: VendorSubstrate) =>
  s.revenue.lifetime_revenue >= amount

export const hasCashFlowHistory = (months: number) => (s: VendorSubstrate) =>
  s.revenue.monthly.length >= months

export const repeatCustomersAtLeast = (n: number) => (s: VendorSubstrate) =>
  s.customers.repeat_customers >= n

export const verifiedDocsAtLeast = (n: number) => (s: VendorSubstrate) =>
  (s.documents?.documents.filter((d) => d.verified).length ?? 0) >= n
