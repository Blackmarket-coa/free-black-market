import { BigNumber } from "@medusajs/framework/utils"
import {
  CART_PAYMENT_AMOUNT_MISMATCH,
  CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
  CART_PAYMENT_REFRESH_FAILED,
  CART_PAYMENT_REFRESH_FAILED_MESSAGE,
  type CartPaymentAmounts,
  cartPaymentAmountMismatchResponse,
  cartPaymentRefreshFailedResponse,
  judgeCartPaymentAmount,
  minorUnitDigits,
  toMinorUnits,
} from "../cart-payment-amount"

/**
 * SD-115: the decision a completion is held to. A card is charged what its
 * session was opened for, so a cart goes on to completion only when every
 * session it could newly authorize is for the cart's total, in the currency's
 * minor unit; when that cannot be told, it does not go on.
 */

const cart = (overrides: Partial<CartPaymentAmounts> = {}, sessions: Array<{ amount?: unknown; status?: string }> = []): CartPaymentAmounts => ({
  id: "cart_1",
  completed_at: null,
  total: 32,
  currency_code: "usd",
  payment_collection: { payment_sessions: sessions.map((s, i) => ({ id: `payses_${i + 1}`, status: "pending", ...s })) },
  ...overrides,
})

describe("minorUnitDigits / toMinorUnits", () => {
  it("reads a currency's minor unit from Medusa's table, whatever the case of the code", () => {
    expect(minorUnitDigits("usd")).toBe(2)
    expect(minorUnitDigits("USD")).toBe(2)
    expect(minorUnitDigits("jpy")).toBe(0)
    expect(minorUnitDigits("bhd")).toBe(3)
  })

  it("has no answer for a code that table does not have, or for no code", () => {
    expect(minorUnitDigits("zzz")).toBeNull()
    expect(minorUnitDigits("")).toBeNull()
    expect(minorUnitDigits(null)).toBeNull()
    expect(minorUnitDigits(undefined)).toBeNull()
    expect(minorUnitDigits(840)).toBeNull()
  })

  it("converts a number, a numeric string and Medusa's BigNumber, which is what the query serves in process", () => {
    expect(toMinorUnits(59.97, 2)).toBe(5997)
    expect(toMinorUnits("59.97", 2)).toBe(5997)
    expect(toMinorUnits(new BigNumber(59.97), 2)).toBe(5997)
    expect(toMinorUnits(1000, 0)).toBe(1000)
    expect(toMinorUnits(1.2344, 3)).toBe(1234)
  })

  it("has no answer for what is not an amount", () => {
    for (const value of [null, undefined, "", "abc", NaN, Infinity, true, {}, []]) {
      expect(toMinorUnits(value, 2)).toBeNull()
    }
  })
})

describe("judgeCartPaymentAmount", () => {
  it("passes a cart whose pending session is for its total", () => {
    expect(judgeCartPaymentAmount(cart({}, [{ amount: 32 }]))).toEqual({ ok: true })
  })

  it("passes when the two agree in the minor unit, as the provider and the buyer see them", () => {
    // The intent is created for the session amount rounded to cents.
    expect(judgeCartPaymentAmount(cart({ total: 59.97 }, [{ amount: 59.970000000001 }]))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ total: new BigNumber(32) }, [{ amount: new BigNumber(32) }]))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ total: "32" }, [{ amount: 32.004 }]))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ total: 1000, currency_code: "jpy" }, [{ amount: 1000.4 }]))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ total: 1.234, currency_code: "bhd" }, [{ amount: 1.2344 }]))).toEqual({ ok: true })
  })

  it("refuses a session for less than the total: orders for the total on a smaller authorization", () => {
    const verdict = judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: 32 }]))
    expect(verdict).toMatchObject({ ok: false, reason: "session_amount_mismatch" })
    expect((verdict as { detail: string }).detail).toContain("is for 3200 and the cart's total is 3600")
  })

  it("refuses a session for more than the total: the buyer would be charged more than the page shows", () => {
    expect(judgeCartPaymentAmount(cart({ total: 13 }, [{ amount: 20 }]))).toMatchObject({ ok: false, reason: "session_amount_mismatch" })
  })

  it("refuses a difference of one minor unit, in each currency's own unit", () => {
    expect(judgeCartPaymentAmount(cart({ total: 32 }, [{ amount: 32.01 }]))).toMatchObject({ ok: false, reason: "session_amount_mismatch" })
    expect(judgeCartPaymentAmount(cart({ total: 1000, currency_code: "jpy" }, [{ amount: 1001 }]))).toMatchObject({
      ok: false,
      reason: "session_amount_mismatch",
    })
    expect(judgeCartPaymentAmount(cart({ total: 1.234, currency_code: "bhd" }, [{ amount: 1.235 }]))).toMatchObject({
      ok: false,
      reason: "session_amount_mismatch",
    })
  })

  it("holds a session that needs more from the buyer to the same amount", () => {
    expect(judgeCartPaymentAmount(cart({}, [{ amount: 29, status: "requires_more" }]))).toMatchObject({
      ok: false,
      reason: "session_amount_mismatch",
    })
  })

  it("refuses when any one of several sessions is for another amount", () => {
    expect(judgeCartPaymentAmount(cart({}, [{ amount: 32 }, { amount: 29 }]))).toMatchObject({ ok: false, reason: "session_amount_mismatch" })
  })

  it("refuses, closed, when the comparison is owed and cannot be made", () => {
    for (const total of [null, undefined, "", "abc", NaN]) {
      expect(judgeCartPaymentAmount(cart({ total }, [{ amount: 32 }]))).toMatchObject({ ok: false, reason: "amount_unknown" })
    }
    for (const amount of [null, undefined, "", "abc", NaN]) {
      expect(judgeCartPaymentAmount(cart({}, [{ amount }]))).toMatchObject({ ok: false, reason: "amount_unknown" })
    }
    for (const currency_code of [null, undefined, "", "zzz"]) {
      expect(judgeCartPaymentAmount(cart({ currency_code }, [{ amount: 32 }]))).toMatchObject({ ok: false, reason: "amount_unknown" })
    }
  })

  it("passes a cart with no session to authorize on to the route, which refuses it itself", () => {
    expect(judgeCartPaymentAmount(cart({}, []))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ payment_collection: null }))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ payment_collection: { payment_sessions: null } }))).toEqual({ ok: true })
    // Nothing to compare, so an unreadable total is not this check's to refuse.
    expect(judgeCartPaymentAmount(cart({ total: null }, []))).toEqual({ ok: true })
  })

  it("does not judge sessions an earlier attempt already authorized: a retry authorizes nothing new", () => {
    for (const status of ["authorized", "captured", "canceled", "error"]) {
      expect(judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: 32, status }]))).toEqual({ ok: true })
    }
  })

  it("passes a completed cart whatever it holds: a replay answers with the order it made", () => {
    expect(judgeCartPaymentAmount(cart({ completed_at: new Date(), total: 36 }, [{ amount: 32 }]))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ completed_at: "2026-11-16T00:00:00.000Z", total: null }, [{ amount: 32 }]))).toEqual({ ok: true })
  })

  it("passes a cart that owes nothing: Medusa authorizes no session at a total of zero or less", () => {
    expect(judgeCartPaymentAmount(cart({ total: 0 }, [{ amount: 20 }]))).toEqual({ ok: true })
    expect(judgeCartPaymentAmount(cart({ total: -1 }, [{ amount: 20 }]))).toEqual({ ok: true })
  })

  it("compares a cart holding a Coalition Credits reservation like any other: credits change neither amount", () => {
    const withReservation = { ...cart({ total: 32 }, [{ amount: 32 }]), metadata: { ccr_credits_reserved: 3 } }
    expect(judgeCartPaymentAmount(withReservation)).toEqual({ ok: true })
    const stale = { ...cart({ total: 36 }, [{ amount: 32 }]), metadata: { ccr_credits_reserved: 3 } }
    expect(judgeCartPaymentAmount(stale)).toMatchObject({ ok: false, reason: "session_amount_mismatch" })
  })
})

describe("the two answers", () => {
  it("a completion refused for its session's amount: 409, a stable code, the buyer's message and no ids", () => {
    expect(cartPaymentAmountMismatchResponse()).toEqual({
      status: 409,
      body: { code: "cart_payment_amount_mismatch", type: "cart_payment_amount_mismatch", message: CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE },
    })
    expect(CART_PAYMENT_AMOUNT_MISMATCH).toBe("cart_payment_amount_mismatch")
    expect(CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE).toMatch(/was not placed/)
    expect(CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE).toMatch(/choose your payment method again/)
  })

  it("a cart write whose payment could not be refreshed: 500, a stable code, and a message that says to try again", () => {
    expect(cartPaymentRefreshFailedResponse()).toEqual({
      status: 500,
      body: { code: "cart_payment_refresh_failed", type: "cart_payment_refresh_failed", message: CART_PAYMENT_REFRESH_FAILED_MESSAGE },
    })
    expect(CART_PAYMENT_REFRESH_FAILED).toBe("cart_payment_refresh_failed")
    expect(CART_PAYMENT_REFRESH_FAILED_MESSAGE).toMatch(/try again/)
  })
})
