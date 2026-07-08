/**
 * oracle.ts — the invariant oracle.
 *
 * Pure, DOM-free assertions over *snapshots* the persona/harness collects. The
 * oracle never touches a Page or the network — that keeps it deterministic and
 * unit-testable (see instrument-check.ts). Callers read the DOM (selectors.ts)
 * or reconstruct expected state (differential.ts), then hand snapshots here.
 *
 * The canonical stress invariants (the pass/fail spine):
 *   no-oversell · no-double-charge · no-double-redeem ·
 *   totals-reconcile · no-stuck-order · inventory-conserved
 * plus the Surfaces-layer refinements:
 *   cart-total == Σ line totals · PDP price == cart == checkout
 *
 * Tier-1 (single-threaded) invariants are fully implemented. Tier-2 (stress)
 * invariants are *decidable pure functions* that evaluate once the stress
 * harness supplies observations; with no observations they return `skipped`
 * (never a false green) and say so.
 */

import type { Severity } from "./verdict"

/** A parsed money-comparison epsilon (half a cent, in major units). */
const MONEY_EPS = 0.005

export type OracleStatus = "pass" | "fail" | "skipped" | "not-applicable"

/** The result of a single invariant check. */
export interface OracleResult {
  /** Stable invariant slug, e.g. "cart-total==line-sum". */
  invariant: string
  status: OracleStatus
  /** Human-readable explanation of the pass/fail/skip. */
  detail: string
  /** Suggested severity if this is a failure (default "major"). */
  severity?: Severity
  /** Structured numbers/ids backing the verdict. */
  evidence?: Record<string, unknown>
}

/** One cart line as read from the DOM (best-effort) or reconstructed. */
export interface CartLine {
  title: string
  vendor?: string
  unitPrice?: number
  quantity: number
  lineTotal: number
}

/** A structured view of the cart, in major currency units. */
export interface CartSnapshot {
  currency: string
  lines: CartLine[]
  /** "Items:" subtotal row. */
  itemsTotal?: number
  tax?: number
  shipping?: number
  discount?: number
  /** "Total:" grand total row. */
  total: number
}

/** Price observed at each stage of the funnel; any may be absent. */
export interface PriceObservation {
  pdp?: number | null
  cart?: number | null
  checkout?: number | null
}

/** Observations the Tier-2 stress harness feeds the concurrency invariants. */
export interface StressObservation {
  /** Units on hand before the run. */
  stockBefore?: number
  /** Units on hand after the run. */
  stockAfter?: number
  /** Units the app reported as successfully sold/reserved. */
  unitsSold?: number
  /** Distinct successful charges recorded for one payment intent. */
  chargesForIntent?: number
  /** Successful redemptions of one single-use code. */
  redemptionsForCode?: number
  /** Order states observed to be terminal (not stuck between states). */
  ordersResolved?: number
  ordersTotal?: number
}

// -------------------------------------------------------------------------
// Money helpers (exported — selectors.ts reuses parseMoney).
// -------------------------------------------------------------------------

/**
 * Parse a money-shaped string into a major-unit number, or null if the text
 * carries no parseable amount. Tolerates "€10.00", "$1,234.56", "1.234,56 €",
 * "10", "-€5.00". Returns null for empty/non-numeric text so scans can skip.
 */
export function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null
  const raw = String(text)
  // Grab the first numeric run incl. separators, tolerating a sign that sits
  // before an optional currency glyph ("-€5.00") or right on the number.
  const m = raw.match(/(-)?\s*[€$£]?\s*(-)?\s*(\d[\d.,\s]*\d|\d)/)
  if (!m) return null
  const negative = m[1] === "-" || m[2] === "-"
  let s = m[3].replace(/\s/g, "")
  const hasComma = s.includes(",")
  const hasDot = s.includes(".")
  if (hasComma && hasDot) {
    // The last-occurring separator is the decimal separator.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".")
    } else {
      s = s.replace(/,/g, "")
    }
  } else if (hasComma) {
    // Comma is decimal if it looks like "X,dd", else a thousands sep.
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "")
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/** Round to cents and compare within half-a-cent. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_EPS
}

// -------------------------------------------------------------------------
// The Oracle.
// -------------------------------------------------------------------------

export class Oracle {
  // ---- Surfaces-layer refinements (Tier 1, fully implemented) ----

  /** cart-total == Σ(line totals). Skipped if the snapshot carried no lines. */
  cartTotalEqualsLineSum(cart: CartSnapshot): OracleResult {
    const inv = "cart-total==line-sum"
    if (!cart.lines.length) {
      return {
        invariant: inv,
        status: "skipped",
        detail: "no cart lines were captured; cannot sum line totals",
      }
    }
    const sum = cart.lines.reduce((a, l) => a + l.lineTotal, 0)
    // The grand total legitimately includes tax/shipping minus discount, so
    // compare against the items subtotal when present, else the grand total.
    const expectAgainst = cart.itemsTotal ?? cart.total
    const ok = moneyEquals(sum, expectAgainst)
    return {
      invariant: inv,
      status: ok ? "pass" : "fail",
      severity: "major",
      detail: ok
        ? `Σ lines (${sum}) matches ${cart.itemsTotal != null ? "items subtotal" : "grand total"} (${expectAgainst})`
        : `Σ lines (${sum}) ≠ ${cart.itemsTotal != null ? "items subtotal" : "grand total"} (${expectAgainst})`,
      evidence: { sum, itemsTotal: cart.itemsTotal, total: cart.total, lines: cart.lines },
    }
  }

  /** PDP price == cart price == checkout price (whichever stages are present). */
  priceConsistency(p: PriceObservation): OracleResult {
    const inv = "price-consistent-across-funnel"
    const seen = (["pdp", "cart", "checkout"] as const)
      .map((k) => ({ k, v: p[k] }))
      .filter((x): x is { k: "pdp" | "cart" | "checkout"; v: number } => typeof x.v === "number")
    if (seen.length < 2) {
      return {
        invariant: inv,
        status: "skipped",
        detail: `only ${seen.length} funnel price(s) observed; need ≥2 to compare`,
        evidence: { ...p },
      }
    }
    const base = seen[0].v
    const bad = seen.find((x) => !moneyEquals(x.v, base))
    const ok = !bad
    return {
      invariant: inv,
      status: ok ? "pass" : "fail",
      severity: "major",
      detail: ok
        ? `price ${base} held across ${seen.map((x) => x.k).join(" == ")}`
        : `price diverged: ${seen[0].k}=${base} vs ${bad!.k}=${bad!.v}`,
      evidence: { ...p },
    }
  }

  /** totals-reconcile: total == items + shipping + tax - discount. */
  totalsReconcile(cart: CartSnapshot): OracleResult {
    const inv = "totals-reconcile"
    if (cart.itemsTotal == null) {
      return {
        invariant: inv,
        status: "skipped",
        detail: "no items subtotal captured; cannot reconcile the summary",
      }
    }
    const expected =
      (cart.itemsTotal ?? 0) + (cart.shipping ?? 0) + (cart.tax ?? 0) - (cart.discount ?? 0)
    const ok = moneyEquals(expected, cart.total)
    return {
      invariant: inv,
      status: ok ? "pass" : "fail",
      severity: "major",
      detail: ok
        ? `items+shipping+tax-discount (${expected}) == total (${cart.total})`
        : `summary does not reconcile: items+shipping+tax-discount (${expected}) ≠ total (${cart.total})`,
      evidence: {
        items: cart.itemsTotal,
        shipping: cart.shipping,
        tax: cart.tax,
        discount: cart.discount,
        total: cart.total,
        expected,
      },
    }
  }

  // ---- Canonical stress invariants (Tier 2 — decidable once fed data) ----

  /** no-oversell: units sold ≤ stock available; stock never goes negative. */
  noOversell(o: StressObservation): OracleResult {
    const inv = "no-oversell"
    if (o.stockBefore == null || o.unitsSold == null) {
      return skipTier2(inv, "needs stockBefore + unitsSold from the stress harness")
    }
    const oversold = o.unitsSold > o.stockBefore || (o.stockAfter != null && o.stockAfter < 0)
    return {
      invariant: inv,
      status: oversold ? "fail" : "pass",
      severity: "blocker",
      detail: oversold
        ? `OVERSOLD: sold ${o.unitsSold} of ${o.stockBefore} available (stockAfter=${o.stockAfter})`
        : `sold ${o.unitsSold} ≤ ${o.stockBefore} available; no oversell`,
      evidence: { ...o },
    }
  }

  /** no-double-charge: exactly one charge per payment intent. */
  noDoubleCharge(o: StressObservation): OracleResult {
    const inv = "no-double-charge"
    if (o.chargesForIntent == null) {
      return skipTier2(inv, "needs chargesForIntent from the stress harness")
    }
    const ok = o.chargesForIntent <= 1
    return {
      invariant: inv,
      status: ok ? "pass" : "fail",
      severity: "blocker",
      detail: ok
        ? `${o.chargesForIntent} charge for the intent; no double-charge`
        : `DOUBLE-CHARGE: ${o.chargesForIntent} charges recorded for one intent`,
      evidence: { ...o },
    }
  }

  /** no-double-redeem: a single-use code redeems at most once. */
  noDoubleRedeem(o: StressObservation): OracleResult {
    const inv = "no-double-redeem"
    if (o.redemptionsForCode == null) {
      return skipTier2(inv, "needs redemptionsForCode from the stress harness")
    }
    const ok = o.redemptionsForCode <= 1
    return {
      invariant: inv,
      status: ok ? "pass" : "fail",
      severity: "major",
      detail: ok
        ? `single-use code redeemed ${o.redemptionsForCode} time(s)`
        : `DOUBLE-REDEEM: single-use code redeemed ${o.redemptionsForCode} times`,
      evidence: { ...o },
    }
  }

  /** no-stuck-order: every order reached a terminal state. */
  noStuckOrder(o: StressObservation): OracleResult {
    const inv = "no-stuck-order"
    if (o.ordersTotal == null || o.ordersResolved == null) {
      return skipTier2(inv, "needs ordersTotal + ordersResolved from the stress harness")
    }
    const stuck = o.ordersTotal - o.ordersResolved
    return {
      invariant: inv,
      status: stuck > 0 ? "fail" : "pass",
      severity: "major",
      detail: stuck > 0
        ? `${stuck} of ${o.ordersTotal} order(s) stuck between states`
        : `all ${o.ordersTotal} order(s) resolved`,
      evidence: { ...o },
    }
  }

  /** inventory-conserved: stockBefore - unitsSold == stockAfter. */
  inventoryConserved(o: StressObservation): OracleResult {
    const inv = "inventory-conserved"
    if (o.stockBefore == null || o.stockAfter == null || o.unitsSold == null) {
      return skipTier2(inv, "needs stockBefore + stockAfter + unitsSold from the stress harness")
    }
    const expected = o.stockBefore - o.unitsSold
    const ok = expected === o.stockAfter
    return {
      invariant: inv,
      status: ok ? "pass" : "fail",
      severity: "major",
      detail: ok
        ? `${o.stockBefore} - ${o.unitsSold} == ${o.stockAfter}; inventory conserved`
        : `LEAK: expected ${expected} on hand, found ${o.stockAfter}`,
      evidence: { ...o, expected },
    }
  }
}

function skipTier2(invariant: string, why: string): OracleResult {
  return {
    invariant,
    status: "skipped",
    detail: `Tier-2 stress invariant — ${why}`,
  }
}

/** Convenience: are there any hard failures in a batch of results? */
export function anyFailed(results: OracleResult[]): boolean {
  return results.some((r) => r.status === "fail")
}
