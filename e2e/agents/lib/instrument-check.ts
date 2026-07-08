/**
 * instrument-check.ts — "verify the instrument".
 *
 * A clean result from a broken harness is worse than a red one. Before any
 * green from this harness is trusted, this smoke-check exercises the harness's own
 * logic against GOLDEN expectations — money parsing, each oracle invariant on
 * known-good AND known-bad snapshots, verdict headline/ranking, and the
 * fail-closed loopback guard. It needs NO running stack and NO browser: it is
 * pure and deterministic, so a failure here means the tooling is wrong, not the
 * app. Run it via `agents/instrument.spec.ts`.
 */

import { isLoopbackHost, assertLoopback } from "./guard"
import {
  Oracle,
  parseMoney,
  moneyEquals,
  type CartSnapshot,
} from "./oracle"
import { VerdictLogger, headlineFrom } from "./verdict"

export interface InstrumentCheck {
  name: string
  ok: boolean
  detail: string
}

export interface InstrumentReport {
  ok: boolean
  passed: number
  failed: number
  checks: InstrumentCheck[]
}

function check(name: string, ok: boolean, detail: string): InstrumentCheck {
  return { name, ok, detail }
}

const goodCart: CartSnapshot = {
  currency: "eur",
  lines: [
    { title: "A", quantity: 1, lineTotal: 10, unitPrice: 10 },
    { title: "B", quantity: 2, lineTotal: 20, unitPrice: 10 },
  ],
  itemsTotal: 30,
  shipping: 5,
  tax: 3,
  discount: 8,
  total: 30, // items(30)+ship(5)+tax(3)-disc(8) = 30
}

const badSumCart: CartSnapshot = {
  ...goodCart,
  lines: [{ title: "A", quantity: 1, lineTotal: 999, unitPrice: 999 }],
}

const badReconcileCart: CartSnapshot = { ...goodCart, total: 12345 }

/** Run all instrument checks and return a structured report. */
export function runInstrumentCheck(): InstrumentReport {
  const oracle = new Oracle()
  const checks: InstrumentCheck[] = []

  // --- money parsing goldens ---
  const moneyCases: Array<[string, number | null]> = [
    ["€10.00", 10],
    ["$1,234.56", 1234.56],
    ["1.234,56 €", 1234.56],
    ["10", 10],
    ["-€5.00", -5],
    ["", null],
    ["free", null],
  ]
  for (const [input, expected] of moneyCases) {
    const got = parseMoney(input)
    const ok = expected == null ? got == null : got != null && moneyEquals(got, expected)
    checks.push(check(`parseMoney(${JSON.stringify(input)})`, ok, `expected ${expected}, got ${got}`))
  }

  // --- cart-total == line-sum ---
  checks.push(
    check(
      "oracle.cartTotalEqualsLineSum PASS on good cart",
      oracle.cartTotalEqualsLineSum(goodCart).status === "pass",
      oracle.cartTotalEqualsLineSum(goodCart).detail
    )
  )
  checks.push(
    check(
      "oracle.cartTotalEqualsLineSum FAIL on bad-sum cart",
      oracle.cartTotalEqualsLineSum(badSumCart).status === "fail",
      oracle.cartTotalEqualsLineSum(badSumCart).detail
    )
  )

  // --- totals reconcile ---
  checks.push(
    check(
      "oracle.totalsReconcile PASS on good cart",
      oracle.totalsReconcile(goodCart).status === "pass",
      oracle.totalsReconcile(goodCart).detail
    )
  )
  checks.push(
    check(
      "oracle.totalsReconcile FAIL on bad-total cart",
      oracle.totalsReconcile(badReconcileCart).status === "fail",
      oracle.totalsReconcile(badReconcileCart).detail
    )
  )

  // --- price consistency ---
  checks.push(
    check(
      "oracle.priceConsistency PASS when funnel agrees",
      oracle.priceConsistency({ pdp: 10, cart: 10, checkout: 10 }).status === "pass",
      "10 == 10 == 10"
    )
  )
  checks.push(
    check(
      "oracle.priceConsistency FAIL when funnel diverges",
      oracle.priceConsistency({ pdp: 10, cart: 12 }).status === "fail",
      "pdp 10 vs cart 12"
    )
  )
  checks.push(
    check(
      "oracle.priceConsistency SKIP with <2 stages",
      oracle.priceConsistency({ pdp: 10 }).status === "skipped",
      "only one stage observed"
    )
  )

  // --- Tier-2 stress invariants (decidable when fed data; skip otherwise) ---
  checks.push(
    check(
      "oracle.noOversell FAIL on oversell",
      oracle.noOversell({ stockBefore: 1, unitsSold: 3 }).status === "fail",
      "sold 3 of 1"
    )
  )
  checks.push(
    check(
      "oracle.noOversell PASS within stock",
      oracle.noOversell({ stockBefore: 5, unitsSold: 2 }).status === "pass",
      "sold 2 of 5"
    )
  )
  checks.push(
    check(
      "oracle.noOversell SKIP without data",
      oracle.noOversell({}).status === "skipped",
      "no stress observation"
    )
  )
  checks.push(
    check(
      "oracle.inventoryConserved FAIL on leak",
      oracle.inventoryConserved({ stockBefore: 5, unitsSold: 2, stockAfter: 1 }).status === "fail",
      "expected 3 on hand, found 1"
    )
  )

  // --- verdict headline + ranking ---
  const vl = new VerdictLogger({ run: "instrument", target: "http://localhost:3000" })
  vl.divergence({ source: "oracle", location: "/x", failureScenario: "minor thing", severity: "minor" })
  vl.divergence({ source: "reachability", location: "/y", failureScenario: "5xx", severity: "blocker" })
  vl.divergence({ source: "oracle", location: "/z", failureScenario: "flake", severity: "major", verdict: "REFUTED" })
  const doc = vl.build()
  checks.push(
    check(
      "verdict headline counts non-refuted only",
      doc.headline === "CHANGES-NEEDED · 1 blocker · 0 major · 1 minor",
      doc.headline
    )
  )
  checks.push(
    check(
      "verdict ranks blocker before minor",
      doc.findings.length === 2 && doc.findings[0].severity === "blocker",
      `first=${doc.findings[0]?.severity}`
    )
  )
  checks.push(
    check(
      "verdict excludes REFUTED from findings, retains in refuted[]",
      doc.findings.length === 2 && doc.refuted.length === 1,
      `findings=${doc.findings.length} refuted=${doc.refuted.length}`
    )
  )
  checks.push(
    check(
      "headlineFrom CLEAR on zero counts",
      headlineFrom({ blocker: 0, major: 0, minor: 0 }) === "CLEAR · 0 blocker · 0 major · 0 minor",
      headlineFrom({ blocker: 0, major: 0, minor: 0 })
    )
  )

  // --- guard ---
  checks.push(check("guard isLoopbackHost localhost", isLoopbackHost("localhost"), "localhost"))
  checks.push(check("guard isLoopbackHost 127.0.0.1", isLoopbackHost("127.0.0.1"), "127.0.0.1"))
  checks.push(check("guard rejects public host", !isLoopbackHost("example.com"), "example.com"))
  let threw = false
  try {
    assertLoopback("https://staging.blackmarket.example", "test")
  } catch {
    threw = true
  }
  checks.push(check("guard.assertLoopback throws off-loopback", threw, "must throw"))

  const failed = checks.filter((c) => !c.ok)
  return {
    ok: failed.length === 0,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  }
}
