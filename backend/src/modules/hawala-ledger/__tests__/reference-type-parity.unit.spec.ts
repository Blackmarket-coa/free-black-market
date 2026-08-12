import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import {
  assertPurchaseContext,
  assertRailInvariants,
  ClosedLoopViolationError,
  PURCHASE_CONTEXT_REFERENCE_TYPES,
  TIMEBANK_REFERENCE_TYPES,
} from "../posture-a-guard"

/**
 * `reference_type` has three vocabularies that must agree, and nothing used to
 * hold them together.
 *
 *   1. `LedgerEntry.reference_type` (models/ledger-entry.ts) — what the model
 *      declares can exist.
 *   2. `PURCHASE_CONTEXT_REFERENCE_TYPES` (posture-a-guard.ts) — what counts as
 *      a goods-or-services context, and therefore what CCR is allowed to move
 *      against under Posture A.
 *   3. The literals real callers actually pass to `createTransfer`.
 *
 * They had drifted into three different lists. The guard blessed six values the
 * model said could not exist (CART, REFUND, PAYOUT, ESCROW_FUND,
 * ESCROW_RELEASE, SUBSCRIPTION_RENEWAL), and `services/collective-hawala.ts`
 * passed a seventh, DEMAND_BOUNTY, that appeared in neither.
 *
 * That last one was a live defect rather than a tidiness problem.
 * `createTransfer` takes its currency from the debit account
 * (`service.ts` — `currency_code: debitAccount.currency_code`), and
 * `assertRailInvariants` routes CCR through `assertPurchaseContext`. So on any
 * CCR-denominated wallet every bounty escrow, milestone payout and escrow
 * refund threw `ClosedLoopViolationError` in strict mode. It had not bitten
 * only because CCR wallets were not yet in production use.
 *
 * The model enum is parsed from source rather than imported: `model.enum()` is
 * Medusa DML, and reading declared values back off the built entity is not a
 * stable public API. Parsing is also what the KARMA ladder parity test does
 * (`packages/bmc-portal-kit/src/tiers.parity.spec.ts`) for the same reason.
 */

const readSource = (relative: string): string =>
  readFileSync(path.resolve(__dirname, relative), "utf8")

/**
 * Parse the model's declared reference types:
 *
 *   reference_type: model.enum([
 *     "ORDER",
 *     ...
 *   ]).nullable(),
 */
const declaredReferenceTypes: string[] = (() => {
  const source = readSource("../models/ledger-entry.ts")
  const block = source.match(
    /reference_type\s*:\s*model\s*\.enum\(\s*\[([\s\S]*?)\]\s*\)/
  )
  if (!block) {
    throw new Error(
      "Could not find the reference_type enum in models/ledger-entry.ts. If it " +
        "was renamed or restructured, update this test rather than deleting it " +
        "— it is the only thing keeping the Posture A guard's vocabulary and " +
        "the model's declared types from drifting apart again."
    )
  }

  return [...block[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1])
})()

/**
 * Every `reference_type: "..."` literal posted anywhere in production code.
 * This is the caller-side vocabulary.
 *
 * Test files are excluded deliberately: specs invent values on purpose to
 * exercise the rejection paths (`NOT_A_REAL_CONTEXT`, `REPAIR_COMPLETE`), and
 * those must not be dragged into the model enum.
 */
const calledReferenceTypes: string[] = (() => {
  const srcRoot = path.resolve(__dirname, "../../..")
  const found = new Set<string>()

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith(".ts") || entry.name.includes(".spec.")) continue

      for (const m of readFileSync(full, "utf8").matchAll(
        /reference_type\s*:\s*"([A-Z0-9_]+)"/g
      )) {
        found.add(m[1])
      }
    }
  }

  walk(srcRoot)
  return [...found]
})()

describe("reference_type vocabulary parity", () => {
  it("parses the model enum", () => {
    // Guards the regex itself: a silent zero-row parse would make every
    // assertion below vacuously true.
    expect(declaredReferenceTypes.length).toBeGreaterThanOrEqual(10)
    expect(declaredReferenceTypes).toContain("ORDER")
  })

  it("finds the production call sites", () => {
    expect(calledReferenceTypes.length).toBeGreaterThan(0)
    // Sanity-check the walk reached the collective money service.
    expect(calledReferenceTypes).toContain("DEMAND_BOUNTY")
  })

  it("excludes reference types that only appear in specs", () => {
    // Guards the exclusion rule itself: specs deliberately post nonsense values
    // to exercise rejection paths, and those must never reach the model enum.
    expect(calledReferenceTypes).not.toContain("NOT_A_REAL_CONTEXT")
  })

  it("declares every reference type the Posture A guard treats as a purchase context", () => {
    const missing = [...PURCHASE_CONTEXT_REFERENCE_TYPES].filter(
      (value) => !declaredReferenceTypes.includes(value)
    )

    // A value the guard blesses but the model does not declare is a silent
    // contradiction: it survives today only because the column is plain TEXT.
    // Any future CHECK constraint, or any code that switches on the declared
    // enum, turns it into a hard failure on a money path.
    expect(missing).toEqual([])
  })

  it("declares every reference type the time-bank rail requires", () => {
    // The HRS guard rejects any hours entry whose reference_type is outside
    // this set, so a real time-bank transfer always writes one of them.
    const missing = [...TIMEBANK_REFERENCE_TYPES].filter(
      (value) => !declaredReferenceTypes.includes(value)
    )

    expect(missing).toEqual([])
  })

  it("declares every reference type production code actually posts", () => {
    const missing = calledReferenceTypes.filter(
      (value) => !declaredReferenceTypes.includes(value)
    )

    expect(missing).toEqual([])
  })
})

describe("DEMAND_BOUNTY under Posture A", () => {
  const bountyTransfer = (entryType: string) => ({
    currency_code: "CCR",
    entry_type: entryType,
    reference_type: "DEMAND_BOUNTY",
    reference_id: "bounty_123",
    debit_account_id: "acct_contributor",
    credit_account_id: "acct_escrow",
  })

  it("treats DEMAND_BOUNTY as a purchase context", () => {
    // A bounty is payment for delivered work — the same goods-or-services
    // category as ORDER. See docs/POSTURE_A_COMPLIANCE.md.
    expect(PURCHASE_CONTEXT_REFERENCE_TYPES.has("DEMAND_BOUNTY")).toBe(true)
  })

  it("allows a CCR bounty escrow", () => {
    expect(() =>
      assertPurchaseContext(bountyTransfer("FEE"), "strict")
    ).not.toThrow()
  })

  it("allows a CCR bounty milestone payout", () => {
    expect(() =>
      assertRailInvariants(bountyTransfer("TRANSFER"), "strict")
    ).not.toThrow()
  })

  it("allows a CCR bounty escrow refund", () => {
    expect(() =>
      assertRailInvariants(bountyTransfer("REFUND"), "strict")
    ).not.toThrow()
  })

  it("still rejects a CCR transfer carrying no context at all", () => {
    // The fix widens the allowed set; it must not disable the guard.
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "CCR",
          entry_type: "TRANSFER",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).toThrow(ClosedLoopViolationError)
  })

  it("still rejects a CCR transfer with an unrecognized reference_type", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "CCR",
          entry_type: "TRANSFER",
          reference_type: "NOT_A_REAL_CONTEXT",
          reference_id: "x_1",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).toThrow(ClosedLoopViolationError)
  })
})
