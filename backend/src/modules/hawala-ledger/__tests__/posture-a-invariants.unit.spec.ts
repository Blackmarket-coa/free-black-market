import {
  assertPurchaseContext,
  ClosedLoopViolationError,
  CCR_CURRENCY_CODE,
  PURCHASE_CONTEXT_REFERENCE_TYPES,
  ISSUER_ENTRY_TYPES,
} from "../posture-a-guard"

/**
 * Posture A closed-loop invariants for Coalition Credits.
 *
 * These tests are the architectural enforcement of the lines documented
 * in `docs/POSTURE_A_COMPLIANCE.md`. A failing test here means CCR could
 * move without a goods/services purchase context — which collapses the
 * payment-facilitator exemption and triggers FinCEN MSB classification.
 *
 * Do NOT loosen these tests without a written compliance review.
 */
describe("posture-a-guard: assertPurchaseContext (strict mode)", () => {
  const base = {
    currency_code: CCR_CURRENCY_CODE,
    entry_type: "TRANSFER",
    debit_account_id: "acct_a",
    credit_account_id: "acct_b",
  }

  it("passes when CCR transfer carries an order_id", () => {
    expect(() =>
      assertPurchaseContext({ ...base, order_id: "order_123" }, "strict")
    ).not.toThrow()
  })

  it("passes when CCR transfer carries a cart_id", () => {
    expect(() =>
      assertPurchaseContext({ ...base, cart_id: "cart_xyz" }, "strict")
    ).not.toThrow()
  })

  it("passes when CCR transfer carries a known purchase reference", () => {
    expect(() =>
      assertPurchaseContext(
        { ...base, reference_type: "ORDER", reference_id: "order_77" },
        "strict"
      )
    ).not.toThrow()
  })

  it("REJECTS a CCR transfer with no purchase context (vendor-to-vendor gift)", () => {
    expect(() => assertPurchaseContext(base, "strict")).toThrow(
      ClosedLoopViolationError
    )
  })

  it("REJECTS a CCR transfer with a reference_type but empty reference_id", () => {
    expect(() =>
      assertPurchaseContext(
        { ...base, reference_type: "ORDER", reference_id: "" },
        "strict"
      )
    ).toThrow(ClosedLoopViolationError)
  })

  it("REJECTS a CCR transfer with an unrecognized reference_type", () => {
    expect(() =>
      assertPurchaseContext(
        { ...base, reference_type: "GIFT", reference_id: "gift_1" },
        "strict"
      )
    ).toThrow(ClosedLoopViolationError)
  })

  it("passes through non-CCR currencies (USD, USDC) without inspection", () => {
    expect(() =>
      assertPurchaseContext(
        { ...base, currency_code: "USD" },
        "strict"
      )
    ).not.toThrow()
    expect(() =>
      assertPurchaseContext(
        { ...base, currency_code: "USDC" },
        "strict"
      )
    ).not.toThrow()
  })

  it("permits issuer-controlled ISSUE entries (mint at payout election)", () => {
    expect(() =>
      assertPurchaseContext({ ...base, entry_type: "ISSUE" }, "strict")
    ).not.toThrow()
  })

  it("permits issuer-controlled BURN entries (CCR retirement)", () => {
    expect(() =>
      assertPurchaseContext({ ...base, entry_type: "BURN" }, "strict")
    ).not.toThrow()
  })

  it("ESCROW_FUND and ESCROW_RELEASE are recognized purchase reference types", () => {
    expect(PURCHASE_CONTEXT_REFERENCE_TYPES.has("ESCROW_FUND")).toBe(true)
    expect(PURCHASE_CONTEXT_REFERENCE_TYPES.has("ESCROW_RELEASE")).toBe(true)
  })

  it("includes the rejected transfer details on the error", () => {
    try {
      assertPurchaseContext(base, "strict")
      fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ClosedLoopViolationError)
      const cle = err as ClosedLoopViolationError
      expect(cle.details.currency_code).toBe(CCR_CURRENCY_CODE)
      expect(cle.details.debit_account_id).toBe("acct_a")
      expect(cle.details.credit_account_id).toBe("acct_b")
    }
  })
})

describe("posture-a-guard: warn / off modes", () => {
  const base = {
    currency_code: CCR_CURRENCY_CODE,
    entry_type: "TRANSFER",
    debit_account_id: "acct_a",
    credit_account_id: "acct_b",
  }

  it("warn mode logs but does not throw", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => assertPurchaseContext(base, "warn")).not.toThrow()
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Posture A closed-loop violation"),
      expect.any(Object)
    )
    spy.mockRestore()
  })

  it("off mode is a no-op (used only during local dev)", () => {
    expect(() => assertPurchaseContext(base, "off")).not.toThrow()
  })
})

describe("posture-a-guard: constants", () => {
  it("CCR_CURRENCY_CODE is 'CCR'", () => {
    expect(CCR_CURRENCY_CODE).toBe("CCR")
  })

  it("purchase reference set includes the v1 ship list", () => {
    for (const ref of ["ORDER", "CART", "REFUND", "PAYOUT"]) {
      expect(PURCHASE_CONTEXT_REFERENCE_TYPES.has(ref)).toBe(true)
    }
  })

  it("issuer entry set includes ISSUE and BURN", () => {
    expect(ISSUER_ENTRY_TYPES.has("ISSUE")).toBe(true)
    expect(ISSUER_ENTRY_TYPES.has("BURN")).toBe(true)
  })
})
