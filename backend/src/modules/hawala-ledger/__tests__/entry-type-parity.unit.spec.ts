import { readFileSync } from "node:fs"
import path from "node:path"

import { ISSUER_ENTRY_TYPES } from "../posture-a-guard"

/**
 * `entry_type` has the same two-vocabulary problem `reference_type` had, and
 * the sibling spec (`reference-type-parity.unit.spec.ts`) exists because that
 * one drifted into a live defect.
 *
 *   1. `LedgerEntry.entry_type` (models/ledger-entry.ts) — what the model
 *      declares can exist.
 *   2. `ISSUER_ENTRY_TYPES` (posture-a-guard.ts) — the entry types treated as
 *      platform issuer operations and therefore exempted from the
 *      purchase-context requirement.
 *
 * They had drifted: the guard blessed ISSUE and BURN, and the model declared
 * neither. That is the more dangerous direction of the two — a guard that
 * exempts a value the model cannot store means the exemption is unreachable,
 * so the first caller to post it fails at the database rather than at the
 * guard, and does so on the money path. `docs/CCR_HRS_IGNITION.md` §2 records
 * this as the first link in the CCR ignition chain.
 *
 * The model enum is parsed from source rather than imported, for the reason
 * the sibling spec gives: `model.enum()` is Medusa DML and reading declared
 * values back off the built entity is not a stable public API.
 */

const declaredEntryTypes: string[] = (() => {
  const source = readFileSync(
    path.resolve(__dirname, "../models/ledger-entry.ts"),
    "utf8"
  )
  const block = source.match(/entry_type\s*:\s*model\s*\.enum\(\s*\[([\s\S]*?)\]\s*\)/)
  if (!block) {
    throw new Error(
      "Could not find the entry_type enum in models/ledger-entry.ts. If it was " +
        "renamed or restructured, update this test rather than deleting it — it " +
        "is the only thing keeping the Posture A guard's issuer vocabulary and " +
        "the model's declared types from drifting apart again."
    )
  }
  return [...block[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1])
})()

describe("entry_type vocabulary parity", () => {
  it("parses the model enum", () => {
    // Guards the regex itself: a silent zero-row parse would make every
    // assertion below vacuously true.
    expect(declaredEntryTypes.length).toBeGreaterThanOrEqual(10)
    expect(declaredEntryTypes).toContain("PURCHASE")
    expect(declaredEntryTypes).toContain("REFUND")
  })

  it("declares every entry type the guard exempts as an issuer operation", () => {
    const missing = [...ISSUER_ENTRY_TYPES].filter(
      (t) => !declaredEntryTypes.includes(t)
    )

    expect(missing).toEqual([])
  })

  it("still declares the CCR mint and burn pair the creator-credits routes post", () => {
    // These two have live callers (convert-xp mints, withdraw burns), so
    // removing them from the model would break a shipping route rather than
    // just a future one.
    expect(declaredEntryTypes).toContain("CREDIT_PAYOUT_MINT")
    expect(declaredEntryTypes).toContain("CREDIT_REFUND_BURN")
  })

  it("declares the generic issuer pair, so funding the issuer is a script not a schema change", () => {
    expect(declaredEntryTypes).toContain("ISSUE")
    expect(declaredEntryTypes).toContain("BURN")
  })
})
