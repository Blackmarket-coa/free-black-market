/**
 * Rail-dispatching guard tests.
 *
 * Covers the new `assertRailInvariants` dispatcher plus the per-rail
 * functions added alongside CCR's existing `assertPurchaseContext`:
 *
 *   - HRS (time-bank): must carry a recognized reference_type and a
 *     reference_id; debit and credit accounts must differ; the
 *     issuer entry types (HOURS_OPEN_BALANCE, HOURS_ARCHIVE_BALANCE)
 *     bypass the reference rule.
 *   - KARMA: rejects every ledger-entry attempt — karma uses
 *     karma_event, not double-entry.
 *   - USD / USDC / GIFT: passthrough.
 *   - Unknown rails: rejected so a typo or a forgotten registry
 *     addition surfaces loudly.
 */

import {
  assertRailInvariants,
  assertHoursTransferAllowed,
  assertKarmaTransferAllowed,
  ClosedLoopViolationError,
  type TransferGuardInput,
} from "../posture-a-guard"

const base = (overrides: Partial<TransferGuardInput> = {}): TransferGuardInput => ({
  currency_code: "HRS",
  entry_type: "TIMEBANK_LOAN",
  reference_type: "TIMEBANK_LOAN",
  reference_id: "loan_123",
  debit_account_id: "acct_A",
  credit_account_id: "acct_B",
  ...overrides,
})

describe("assertHoursTransferAllowed (HRS rail)", () => {
  it("passes a well-formed time-bank loan entry", () => {
    expect(() => assertHoursTransferAllowed(base(), "strict")).not.toThrow()
  })

  it("passes a TIMEBANK_RETURN entry", () => {
    expect(() =>
      assertHoursTransferAllowed(
        base({
          entry_type: "TIMEBANK_RETURN",
          reference_type: "TIMEBANK_RETURN",
          reference_id: "loan_123",
        }),
        "strict"
      )
    ).not.toThrow()
  })

  it("passes platform-internal HOURS_OPEN_BALANCE without a reference", () => {
    expect(() =>
      assertHoursTransferAllowed(
        base({
          entry_type: "HOURS_OPEN_BALANCE",
          reference_type: null,
          reference_id: null,
        }),
        "strict"
      )
    ).not.toThrow()
  })

  it("rejects HRS transfer with no reference_type", () => {
    expect(() =>
      assertHoursTransferAllowed(
        base({ reference_type: null, reference_id: null }),
        "strict"
      )
    ).toThrow(ClosedLoopViolationError)
  })

  it("rejects HRS transfer with a non-timebank reference_type", () => {
    expect(() =>
      assertHoursTransferAllowed(
        base({ reference_type: "ORDER", reference_id: "order_abc" }),
        "strict"
      )
    ).toThrow(ClosedLoopViolationError)
  })

  it("rejects self-transfer (debit and credit same account)", () => {
    expect(() =>
      assertHoursTransferAllowed(
        base({ debit_account_id: "acct_A", credit_account_id: "acct_A" }),
        "strict"
      )
    ).toThrow(/debit and credit accounts/)
  })

  it("is a no-op when currency_code is not HRS", () => {
    expect(() =>
      assertHoursTransferAllowed(base({ currency_code: "CCR" }), "strict")
    ).not.toThrow()
  })

  it("warns rather than throws in warn mode", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(() =>
      assertHoursTransferAllowed(
        base({ reference_type: null, reference_id: null }),
        "warn"
      )
    ).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("is a no-op in off mode", () => {
    expect(() =>
      assertHoursTransferAllowed(
        base({ reference_type: null, reference_id: null }),
        "off"
      )
    ).not.toThrow()
  })
})

describe("assertKarmaTransferAllowed (KARMA rail)", () => {
  it("rejects every KARMA ledger-entry attempt — karma uses karma_event", () => {
    expect(() =>
      assertKarmaTransferAllowed(
        {
          currency_code: "KARMA",
          entry_type: "KARMA_ACCRUAL",
          reference_type: "REPAIR_COMPLETE",
          reference_id: "repair_42",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).toThrow(/Karma is non-fungible/)
  })

  it("is a no-op when currency_code is not KARMA", () => {
    expect(() =>
      assertKarmaTransferAllowed(
        base({ currency_code: "HRS" }) as TransferGuardInput,
        "strict"
      )
    ).not.toThrow()
  })

  it("warns rather than throws in warn mode", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(() =>
      assertKarmaTransferAllowed(
        {
          currency_code: "KARMA",
          entry_type: "KARMA_ACCRUAL",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "warn"
      )
    ).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe("assertRailInvariants (dispatcher)", () => {
  it("dispatches CCR to the purchase-context check", () => {
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
    ).toThrow(/Coalition Credits/)
  })

  it("dispatches CCR with a valid order to passthrough", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "CCR",
          entry_type: "TRANSFER",
          order_id: "order_1",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).not.toThrow()
  })

  it("dispatches HRS to the time-bank check", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "HRS",
          entry_type: "TIMEBANK_LOAN",
          reference_type: "TIMEBANK_LOAN",
          reference_id: "loan_1",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).not.toThrow()
  })

  it("dispatches KARMA to the rejection path", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "KARMA",
          entry_type: "KARMA_ACCRUAL",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).toThrow(/Karma is non-fungible/)
  })

  it("passes USD as a cash-rail passthrough", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "USD",
          entry_type: "TRANSFER",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).not.toThrow()
  })

  it("passes USDC as a cash-rail passthrough", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "USDC",
          entry_type: "TRANSFER",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).not.toThrow()
  })

  it("passes GIFT as audit-only passthrough", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "GIFT",
          entry_type: "AUDIT_ONLY",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).not.toThrow()
  })

  it("rejects unknown rails so a typo or a forgotten registry addition surfaces", () => {
    expect(() =>
      assertRailInvariants(
        {
          currency_code: "BITCOIN",
          entry_type: "TRANSFER",
          debit_account_id: "acct_A",
          credit_account_id: "acct_B",
        },
        "strict"
      )
    ).toThrow(/not registered/)
  })
})
