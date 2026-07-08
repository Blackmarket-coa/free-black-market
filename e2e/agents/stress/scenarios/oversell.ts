/**
 * oversell.ts — the check-then-write race dimension.
 *
 * This harness flags check-then-write ("is it available?" then write with no DB
 * uniqueness/atomicity guard) as the single most common storefront correctness
 * bug. This file encodes that standing dimension as three GATED scenarios:
 *
 *   1. oversell-last-unit   — N actors race to buy the SAME last in-stock unit
 *                             → assert no-oversell + inventory-conserved.
 *   2. coupon-double-redeem — two+ simultaneous redemptions of a single-use code
 *                             → assert no-double-redeem.
 *   3. payment-replay       — payment retry / webhook replay against the LOCAL
 *                             stub provider (pp_system_default) → no-double-charge.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  GATED-ON-BUG-01. Every scenario below is a WIRING STUB: `task`/`observe`   │
 * │  are left mostly unset so `runScenario()` HONESTLY SKIPS them until:        │
 * │    (a) BUG-01 (cart-creation 500) is fixed  → cart POST succeeds, and       │
 * │    (b) inventory is pinned to a known last-unit count.                      │
 * │  Set STRESS_BUG01_CLEARED=1 + STRESS_INVENTORY_PINNED=<n> to open the gate. │
 * │  Even with the gate open, an UNWIRED task still refuses a false green.      │
 * │                                                                            │
 * │  The `observe()` mappers ARE provided to fix the accounting shape now; the  │
 * │  `task` (the actual loopback contention) is the remaining wiring point,     │
 * │  fleshed out against the FIXED checkout and verified on the local stack.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * All contention runs over the swarm's loopback API context (the load engine —
 * NOT a DOM persona) and, for any payment step, MUST use `assertLocalProvider`
 * so it can only ever touch the local stub. No real gateway, no metered
 * calls, email is a local no-op.
 */

import type { ScenarioDef } from "../swarm"

/**
 * WIRING NOTE (all three scenarios). When BUG-01 clears, wire each `task` to run
 * the contention over `ctx.request()` (the loopback API context), e.g. for
 * oversell: create a cart → add the pinned last-unit variant → complete via
 * `assertLocalProvider(ctx.paymentProvider)`; set `soldUnit: true` only when the
 * app confirms the sale. `observe()` already maps those flags into the oracle's
 * StressObservation, so once `task` is wired the verdict is automatic.
 */

/** #1 — concurrent add-to-cart/checkout on the LAST in-stock unit. */
export const oversellLastUnit: ScenarioDef = {
  name: "oversell-last-unit",
  invariant: "no-oversell",
  gatedOn: "BUG-01",
  description:
    "N actors concurrently add-to-cart and check out the SAME last in-stock unit. The app must " +
    "sell at most the pinned stock (no oversell) and conserve inventory (stockBefore - sold == " +
    "stockAfter). This is the canonical check-then-write race.",
  // task: UNWIRED — GATED-ON-BUG-01 (see WIRING NOTE). Honest skip until wired.
  observe: (run, gate) => {
    const unitsSold = run.outcomes.filter((o) => o.soldUnit).length
    const stockBefore = gate.inventoryPinned ?? undefined
    return {
      stockBefore,
      unitsSold,
      stockAfter: stockBefore != null ? stockBefore - unitsSold : undefined,
    }
  },
  checks: (oracle, obs) => [oracle.noOversell(obs), oracle.inventoryConserved(obs)],
}

/** #2 — two+ simultaneous redemptions of a single-use coupon / gift-card code. */
export const couponDoubleRedeem: ScenarioDef = {
  name: "coupon-double-redeem",
  invariant: "no-double-redeem",
  gatedOn: "BUG-01",
  description:
    "Many actors race to redeem ONE single-use coupon / gift-card code simultaneously. The app " +
    "must record at most one successful redemption (no double-redeem TOCTOU).",
  // task: UNWIRED — GATED-ON-BUG-01. Requires a working cart (BUG-01) to attach a code.
  observe: (run) => ({
    redemptionsForCode: run.outcomes.filter((o) => o.redeemed).length,
  }),
  checks: (oracle, obs) => [oracle.noDoubleRedeem(obs)],
}

/** #3 — payment retry / webhook replay against the LOCAL stub provider. */
export const paymentReplayIdempotency: ScenarioDef = {
  name: "payment-replay-idempotency",
  invariant: "no-double-charge",
  gatedOn: "BUG-01",
  description:
    "Retry the payment / replay the webhook for ONE payment intent concurrently against the local " +
    "stub provider (pp_system_default — no real gateway). The app must charge the intent at most " +
    "once (idempotent). Also surfaces stuck orders that never reach a terminal state.",
  // task: UNWIRED — GATED-ON-BUG-01. Must use assertLocalProvider(ctx.paymentProvider).
  observe: (run) => {
    const chargesForIntent = run.outcomes.filter((o) => o.charged).length
    const ordersTotal = run.outcomes.length
    const ordersResolved = run.outcomes.filter((o) => o.ok).length
    return { chargesForIntent, ordersTotal, ordersResolved }
  },
  checks: (oracle, obs) => [oracle.noDoubleCharge(obs), oracle.noStuckOrder(obs)],
}
