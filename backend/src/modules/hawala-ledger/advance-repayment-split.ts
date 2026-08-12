/**
 * Splitting a vendor-advance repayment between principal and fee.
 *
 * An advance is structured as a factor rate: the vendor receives
 * `principal_amount` in cash and owes `principal_amount * fee_rate` back, so a
 * 1.15 factor on a $1,000 advance creates a $1,150 obligation — $1,000 of
 * principal and $150 of fee.
 *
 * Repayments arrive as a slice of each sale (`repayment_rate` of the sale
 * amount), and every such payment retires part of both components. Until this
 * module existed, `processAdvanceRepayment` recorded the whole payment as
 * principal with a `// Simplified - in reality split principal/fee` comment,
 * so `AdvanceRepayment.fee_amount` was always zero and
 * `VendorAdvance.total_fee_charged` was never written at all. Advance fee
 * revenue was therefore invisible in the ledger's own records — it existed only
 * as the gap between `principal_amount` and `outstanding_balance`.
 *
 * The split is pro-rata (constant proportion): each dollar repaid retires
 * principal and fee in the same ratio they bear in the total obligation. Since
 * total = principal * fee_rate, principal's share of every dollar is
 * `1 / fee_rate`. That is the conventional treatment for factor-rate advances,
 * where the fee is fixed at origination rather than accruing over time — there
 * is no interest to amortize, so there is no reason to front-load either side.
 *
 * The final repayment is trued up against principal actually recorded so far
 * rather than computed pro-rata. Without that, eight-decimal rounding on each
 * instalment would leave the sum of `principal_amount` a few sub-cents away
 * from the advance's real principal, and the books would never quite close.
 *
 * Note: `VendorAdvance` is quiescent under Posture A pending legal review (see
 * docs/POSTURE_A_COMPLIANCE.md). This corrects how a repayment is recorded; it
 * does not activate the feature.
 */

/** Matches the NUMERIC(20,8) precision the ledger columns are stored at. */
const DECIMALS = 8

const round = (value: number): number => {
  const factor = 10 ** DECIMALS
  return Math.round(value * factor) / factor
}

export type AdvanceRepaymentSplitInput = {
  /** The payment being recorded. */
  repayment_amount: number
  /** Factor rate from the advance, e.g. 1.15. */
  fee_rate: number
  /** Original cash advanced (`VendorAdvance.principal_amount`). */
  principal_amount: number
  /** Sum of `principal_amount` across repayments already recorded. */
  prior_principal_repaid: number
  /** True when this payment closes the advance out. */
  is_final: boolean
}

export type AdvanceRepaymentSplit = {
  principal_amount: number
  fee_amount: number
}

/**
 * Split one repayment into its principal and fee components.
 *
 * The two returned values always sum to exactly `repayment_amount`: `fee` is
 * derived by subtraction, so no rounding residue can escape into the gap.
 */
export const splitAdvanceRepayment = (
  input: AdvanceRepaymentSplitInput
): AdvanceRepaymentSplit => {
  const {
    repayment_amount: repayment,
    fee_rate: feeRate,
    principal_amount: principalTotal,
    prior_principal_repaid: priorPrincipal,
    is_final: isFinal,
  } = input

  if (!Number.isFinite(repayment) || repayment <= 0) {
    return { principal_amount: 0, fee_amount: 0 }
  }

  // Principal remaining to be retired. Never attribute more principal than the
  // advance actually carried, however the caller's balances have drifted.
  const principalRemaining = Math.max(
    0,
    round((Number.isFinite(principalTotal) ? principalTotal : 0) -
      (Number.isFinite(priorPrincipal) ? priorPrincipal : 0))
  )

  // A fee rate at or below 1 means no fee was structured (or the field is
  // missing/corrupt). Treat the whole payment as principal rather than
  // inventing a fee — and rather than dividing by zero.
  const hasFee = Number.isFinite(feeRate) && feeRate > 1

  const rawPrincipal = isFinal
    ? principalRemaining
    : hasFee
      ? repayment / feeRate
      : repayment

  // Clamp into [0, min(repayment, principalRemaining)]. Once principal is fully
  // retired the remainder of every payment is fee, which is what a factor-rate
  // advance means when it runs to term.
  const principal = round(
    Math.min(Math.max(rawPrincipal, 0), repayment, principalRemaining)
  )

  return {
    principal_amount: principal,
    fee_amount: round(repayment - principal),
  }
}
