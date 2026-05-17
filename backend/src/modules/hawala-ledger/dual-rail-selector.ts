/**
 * Dual-rail settlement selector per AGGRESSIVE_OPERATIONS_GUIDE.md §5.1.
 *
 * Picks Stripe-ACH or Stellar-USDC for a given settlement amount based on
 * currency, amount thresholds, and current bridge health. Pure function;
 * no I/O. Callers (jobs, settlement routes) snapshot bridge health
 * separately via `getBridgeHealth()` and feed it in here.
 *
 * The selector is only valid for **cash-convertible** rails — USD and
 * USDC. Calling it with a closed-loop rail (CCR, HRS, KARMA, GIFT)
 * throws: those rails settle through their own paths (Stellar custom
 * asset, time-bank ledger entries, karma_event log, audit-only) and
 * silently routing them to Stripe-ACH would be a closed-loop
 * violation. See `rails.ts` for the rail registry.
 *
 * Selection rules in order:
 *   1. Reject non-cash rails outright (throws).
 *   2. If the amount is below `minStellarAmount`, force Stripe-ACH —
 *      Stellar transaction fees are flat in stroops, but for sub-dollar
 *      amounts the Stripe fee is competitive and avoids on-chain noise.
 *   3. If the bridge is unhealthy or USDC liquidity is below the
 *      requested amount, force Stripe-ACH.
 *   4. Otherwise, prefer Stellar-USDC.
 */

import { CASH_RAILS, RAIL_REGISTRY, type RailCode } from "./rails"

export class NonCashRailError extends Error {
  constructor(public readonly rail: string) {
    super(
      `dual-rail-selector called with non-cash rail "${rail}". Use the ` +
        `rail-specific path (CCR via posture-a-guard; HRS via time-bank; ` +
        `KARMA via karma_event; GIFT is audit-only). ` +
        `See backend/src/modules/hawala-ledger/rails.ts.`
    )
    this.name = "NonCashRailError"
  }
}

export type Rail = "stripe_ach" | "stellar_usdc"

export type BridgeHealthSnapshot = {
  horizon_reachable: boolean
  usdc_balance: number
  last_batch_status: "succeeded" | "pending" | "failed" | "unknown"
}

export type SelectorInput = {
  amount: number
  currency: string
  health: BridgeHealthSnapshot
  /**
   * Settlements below this amount route through Stripe-ACH even when
   * the Stellar bridge is healthy. Default 1.00 USD.
   */
  minStellarAmount?: number
  /**
   * Force a particular rail regardless of automatic selection. Operators
   * use this for incident response (e.g., disable Stellar entirely
   * during a network freeze). Defaults to none.
   */
  forceRail?: Rail
}

export type SelectorDecision = {
  rail: Rail
  reasons: Array<{ check: string; outcome: "pass" | "fail" | "skip"; detail?: string }>
}

export function selectSettlementRail(input: SelectorInput): SelectorDecision {
  const reasons: SelectorDecision["reasons"] = []

  if (input.forceRail) {
    return {
      rail: input.forceRail,
      reasons: [
        { check: "force_rail", outcome: "pass", detail: `forced by operator: ${input.forceRail}` },
      ],
    }
  }

  const minStellar = input.minStellarAmount ?? 1.0
  const currency = input.currency.toUpperCase()

  // The selector is for cash rails only. Closed-loop rails (CCR, HRS,
  // KARMA, GIFT) have their own paths and silently routing them to
  // Stripe-ACH would be a closed-loop violation — fail loud instead.
  if (RAIL_REGISTRY[currency as RailCode] && !CASH_RAILS.has(currency as RailCode)) {
    throw new NonCashRailError(currency)
  }

  if (currency !== "USD" && currency !== "USDC") {
    reasons.push({
      check: "currency",
      outcome: "fail",
      detail: `${currency} not supported on Stellar bridge; routing Stripe-ACH`,
    })
    return { rail: "stripe_ach", reasons }
  }
  reasons.push({ check: "currency", outcome: "pass" })

  if (input.amount < minStellar) {
    reasons.push({
      check: "amount_threshold",
      outcome: "fail",
      detail: `amount ${input.amount} < minStellarAmount ${minStellar}; routing Stripe-ACH`,
    })
    return { rail: "stripe_ach", reasons }
  }
  reasons.push({ check: "amount_threshold", outcome: "pass" })

  if (!input.health.horizon_reachable) {
    reasons.push({
      check: "horizon_reachable",
      outcome: "fail",
      detail: "Horizon unreachable; routing Stripe-ACH",
    })
    return { rail: "stripe_ach", reasons }
  }
  reasons.push({ check: "horizon_reachable", outcome: "pass" })

  if (input.health.last_batch_status === "failed") {
    reasons.push({
      check: "last_batch_status",
      outcome: "fail",
      detail: "previous batch failed; routing Stripe-ACH while bridge recovers",
    })
    return { rail: "stripe_ach", reasons }
  }
  reasons.push({
    check: "last_batch_status",
    outcome: "pass",
    detail: input.health.last_batch_status,
  })

  if (input.health.usdc_balance < input.amount) {
    reasons.push({
      check: "usdc_liquidity",
      outcome: "fail",
      detail: `bridge USDC balance ${input.health.usdc_balance} < amount ${input.amount}; routing Stripe-ACH`,
    })
    return { rail: "stripe_ach", reasons }
  }
  reasons.push({ check: "usdc_liquidity", outcome: "pass" })

  return { rail: "stellar_usdc", reasons }
}
