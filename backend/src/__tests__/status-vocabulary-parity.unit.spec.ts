import { readFileSync } from "node:fs"
import path from "node:path"

import { InvoiceStatus } from "../modules/accounts-receivable/terms"
import { QuoteStatus } from "../modules/quote/pricing"
import { DisputeReason, DisputeStatus } from "../modules/order-dispute/resolution"

/**
 * Every status vocabulary in this session's new modules is written down twice:
 * once as a TypeScript enum or union that the code branches on, and once as a
 * Postgres CHECK constraint that decides whether a row may exist. Nothing
 * holds the two together.
 *
 * That gap is not hypothetical here. `dec8156` fixed exactly this class of
 * drift in `hawala-ledger`: `posture-a-guard`'s `ISSUER_ENTRY_TYPES` had
 * blessed ISSUE and BURN since it was written while `LedgerEntry` declared
 * neither, so the exemption was unreachable and the first caller to post one
 * would have failed at the database rather than at the guard — on the money
 * path. `reference-type-parity.unit.spec.ts` exists because the sibling enum
 * drifted into a live defect.
 *
 * The failure mode is asymmetric, which is why both directions are checked:
 *
 * - A value in the enum but NOT in the CHECK is a runtime 500 the first time
 *   that state is reached. The code believes it can write it; the database
 *   refuses. Tests that stub the DB never see it.
 * - A value in the CHECK but NOT in the enum is dead permission — harmless
 *   today, and exactly how the `CART` reference type sat blessed-but-unwritten
 *   for months while the compliance document claimed the mechanism existed.
 *
 * CHECK constraints are parsed from the migration source rather than read from
 * a live database: these specs run without one. Enums are imported directly
 * where they are ordinary TypeScript, and parsed from source only where the
 * vocabulary is a `model.enum()` DML call or a string union, following the
 * precedent in `reference-type-parity.unit.spec.ts` (reading declared values
 * back off a built Medusa entity is not a stable public API).
 */

const readSource = (relative: string): string =>
  readFileSync(path.resolve(__dirname, relative), "utf8")

/**
 * Pull the quoted values out of a named CHECK constraint:
 *
 *   CONSTRAINT "CK_ar_invoice_status" CHECK (
 *     "status" IN ('draft', 'issued', ...)
 *   )
 */
const checkConstraintValues = (
  migrationSource: string,
  constraintName: string
): string[] => {
  const block = migrationSource.match(
    new RegExp(
      `CONSTRAINT\\s+"${constraintName}"\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*(?:,|\\n\\s*\\))`,
      "m"
    )
  )
  if (!block) {
    throw new Error(
      `Could not find CHECK constraint ${constraintName} in the migration. If it ` +
        `was renamed or restructured, update this test rather than deleting it — ` +
        `it is the only thing keeping the TypeScript vocabulary and the database's ` +
        `idea of a valid row from drifting apart.`
    )
  }
  return [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
}

const sorted = (values: readonly string[]): string[] => [...values].sort()

describe("accounts-receivable: invoice status parity", () => {
  const migration = readSource(
    "../modules/accounts-receivable/migrations/Migration20260902000000CreateAccountsReceivable.ts"
  )
  const checkValues = checkConstraintValues(migration, "CK_ar_invoice_status")

  it("parses a non-empty constraint", () => {
    // Guards the regex: a silent zero-value parse makes every assertion below
    // vacuously true, which is worse than no test at all.
    expect(checkValues.length).toBeGreaterThanOrEqual(5)
    expect(checkValues).toContain("draft")
  })

  it("agrees exactly with InvoiceStatus", () => {
    expect(sorted(checkValues)).toEqual(sorted(Object.values(InvoiceStatus)))
  })

  it("does not permit a derived status to be stored", () => {
    // `overdue` and `partially_paid` are computed by presentationStatus from
    // (due date, payments, now). If either ever reached the database it would
    // become a second source of truth that a missed sweep silently falsifies.
    expect(checkValues).not.toContain("overdue")
    expect(checkValues).not.toContain("partially_paid")
  })
})

describe("quote: status parity", () => {
  const migration = readSource(
    "../modules/quote/migrations/Migration20260902000200CreateQuote.ts"
  )
  const checkValues = checkConstraintValues(migration, "CK_quote_status")

  it("parses a non-empty constraint", () => {
    expect(checkValues.length).toBeGreaterThanOrEqual(6)
    expect(checkValues).toContain("draft")
  })

  it("agrees exactly with QuoteStatus", () => {
    expect(sorted(checkValues)).toEqual(sorted(Object.values(QuoteStatus)))
  })
})

describe("order-dispute: status and reason parity", () => {
  const migration = readSource(
    "../modules/order-dispute/migrations/Migration20260902000300CreateOrderDispute.ts"
  )

  it("status agrees exactly with DisputeStatus", () => {
    const checkValues = checkConstraintValues(
      migration,
      "CK_order_dispute_status"
    )
    expect(checkValues.length).toBeGreaterThanOrEqual(5)
    expect(sorted(checkValues)).toEqual(sorted(Object.values(DisputeStatus)))
  })

  it("reason agrees exactly with DisputeReason", () => {
    const checkValues = checkConstraintValues(
      migration,
      "CK_order_dispute_reason"
    )
    expect(checkValues.length).toBeGreaterThanOrEqual(6)
    expect(sorted(checkValues)).toEqual(sorted(Object.values(DisputeReason)))
  })

  it("permits exactly the actor types the service writes", () => {
    // `actor_type` is a plain text column on the event log rather than an
    // enum, so the CHECK is the only thing constraining it. `system` is
    // included for events no human initiated; the other three mirror
    // DisputeActor.
    const checkValues = checkConstraintValues(
      migration,
      "CK_order_dispute_event_actor"
    )
    expect(sorted(checkValues)).toEqual(["admin", "buyer", "seller", "system"])
  })
})

describe("blackstar: event receipt outcome parity", () => {
  const migration = readSource(
    "../modules/blackstar-fulfillment/migrations/Migration20260902000400CreateBlackstarEventReceipt.ts"
  )
  const checkValues = checkConstraintValues(
    migration,
    "CK_blackstar_event_receipt_outcome"
  )

  /**
   * `StatusDecision["reason"]` is a string union rather than an enum, so it is
   * parsed from source the same way the sibling spec parses `model.enum()`.
   */
  const decisionReasons: string[] = (() => {
    const source = readSource("../modules/blackstar-fulfillment/shipment-lifecycle.ts")
    const block = source.match(/reason\s*:\s*\n?([\s\S]*?)\n\}/)
    if (!block) {
      throw new Error(
        "Could not find the StatusDecision reason union in shipment-lifecycle.ts. " +
          "Update this test rather than deleting it — it is what keeps the " +
          "receipt table's CHECK from refusing an outcome the guard can produce."
      )
    }
    return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
  })()

  it("parses both vocabularies", () => {
    expect(checkValues.length).toBeGreaterThanOrEqual(6)
    expect(decisionReasons.length).toBeGreaterThanOrEqual(6)
  })

  it("permits every outcome the ordering guard can produce", () => {
    // The dangerous direction: a guard result the database refuses is a 500 on
    // the inbound bridge, and the bridge is at-least-once, so Blackstar would
    // retry it forever.
    for (const reason of decisionReasons) {
      expect(checkValues).toContain(reason)
    }
  })

  it("permits `ignored`, which no writer produces today", () => {
    // Deliberate dead permission, recorded rather than quietly dropped: the
    // receiver currently answers an unknown event_type with 202 `ignored`
    // BEFORE reaching applyBlackstarEvent, so no receipt is written and a
    // newer Blackstar emitting an event type this FBM does not understand is
    // invisible to operators. The column is ready for that receipt when the
    // receiver is changed to write one. If that is decided against instead,
    // drop the value from the CHECK — do not leave it blessed-but-unwritten,
    // which is precisely how `CART` sat unbuilt while POSTURE_A_COMPLIANCE
    // claimed the mechanism existed.
    expect(checkValues).toContain("ignored")
    expect(decisionReasons).not.toContain("ignored")
  })
})
