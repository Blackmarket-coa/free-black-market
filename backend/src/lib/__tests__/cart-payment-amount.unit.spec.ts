import { BigNumber, MedusaError } from "@medusajs/framework/utils"
import {
  CART_ALREADY_COMPLETED_MESSAGE,
  CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE,
  CART_PAYMENT_AMOUNT_MISMATCH,
  CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
  CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE,
  CART_PAYMENT_REFRESH_FAILED,
  CART_PAYMENT_REFRESH_FAILED_MESSAGE,
  CartPaymentAmountError,
  type CartPaymentAmounts,
  cartAlreadyCompletedResponse,
  cartPaymentAmountMismatchResponse,
  cartPaymentAmountRefusalResponse,
  cartPaymentRefreshFailedResponse,
  isCartPaymentAmountRefusal,
  judgeCartPaymentAmount,
  minorUnitDigits,
  paymentsLeftWithoutSession,
  sessionsNotForCartTotal,
  toMinorUnits,
} from "../cart-payment-amount"

/**
 * SD-115: the decision a completion is held to. A card is charged what its
 * session was opened for, so a cart goes on to completion only when every
 * session the completion would pay with is for the cart's total, in the
 * currency's minor unit; when that cannot be told, it does not go on.
 */

const cart = (
  overrides: Partial<CartPaymentAmounts> = {},
  sessions: Array<{ id?: string | null; amount?: unknown; status?: string }> = []
): CartPaymentAmounts => ({
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

  it("holds a session an earlier attempt authorized to the same amount: the orders are recorded on its payment at the cart's total", () => {
    // Measured before this was compared: authorized at 32, the cart then
    // repriced to 36, completed into orders of 15 and 21 on one payment of 32.
    const verdict = judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: 32, status: "authorized" }]))
    expect(verdict).toMatchObject({ ok: false, reason: "session_amount_mismatch" })
    expect((verdict as { detail: string }).detail).toContain("authorized session payses_1 is for 3200 and the cart's total is 3600")
    expect(judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: 36, status: "authorized" }]))).toEqual({ ok: true })
  })

  it("refuses a captured session for another amount with a reason of its own: money was taken, so the buyer's message must not say it was not", () => {
    expect(judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: 32, status: "captured" }]))).toMatchObject({
      ok: false,
      reason: "captured_amount_mismatch",
    })
    expect(judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: 36, status: "captured" }]))).toEqual({ ok: true })
    // It comes first when a pending session is wrong as well, whatever their order.
    for (const sessions of [
      [{ amount: 29 }, { amount: 32, status: "captured" }],
      [{ amount: 32, status: "captured" }, { amount: 29 }],
    ]) {
      expect(judgeCartPaymentAmount(cart({ total: 36 }, sessions))).toMatchObject({ ok: false, reason: "captured_amount_mismatch" })
    }
  })

  it("a known wrong amount is named before an unreadable one", () => {
    expect(judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: null }, { amount: 32 }]))).toMatchObject({
      ok: false,
      reason: "session_amount_mismatch",
    })
    // A captured session whose amount cannot be read is not known to be for another amount.
    expect(judgeCartPaymentAmount(cart({ total: 36 }, [{ amount: null, status: "captured" }]))).toMatchObject({
      ok: false,
      reason: "amount_unknown",
    })
  })

  it("does not judge sessions no completion pays with: cancelled, or failed", () => {
    for (const status of ["canceled", "error"]) {
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

describe("sessionsNotForCartTotal: what is deleted so that the next session is the only one, and is for the total", () => {
  it("names every session that is not for the total and has captured nothing, whatever its status", () => {
    const sessions = [
      { id: "payses_ok", amount: 36 },
      { id: "payses_pending", amount: 32 },
      { id: "payses_more", amount: 29, status: "requires_more" },
      { id: "payses_authorized", amount: 32, status: "authorized" },
      { id: "payses_unreadable", amount: null },
    ]
    expect(sessionsNotForCartTotal(cart({ total: 36 }, sessions))).toEqual([
      "payses_pending",
      "payses_more",
      "payses_authorized",
      "payses_unreadable",
    ])
  })

  it("never names a captured session: its intent cannot be cancelled and its money needs a refund", () => {
    expect(sessionsNotForCartTotal(cart({ total: 36 }, [{ id: "payses_captured", amount: 32, status: "captured" }]))).toEqual([])
  })

  it("names none when every session is for the total, including with the collection behind it or not: only the session's own amount counts", () => {
    expect(sessionsNotForCartTotal(cart({ total: 19 }, [{ amount: 19 }]))).toEqual([])
    expect(sessionsNotForCartTotal(cart({ total: 19 }, [{ id: "payses_raced", amount: 17 }]))).toEqual(["payses_raced"])
  })

  it("names none where no comparison is owed, or the cart's own side cannot be read", () => {
    const stale = [{ amount: 32 }]
    expect(sessionsNotForCartTotal(cart({ total: 36, completed_at: new Date() }, stale))).toEqual([])
    expect(sessionsNotForCartTotal(cart({ total: 0 }, stale))).toEqual([])
    expect(sessionsNotForCartTotal(cart({ total: null }, stale))).toEqual([])
    expect(sessionsNotForCartTotal(cart({ total: 36, currency_code: "zzz" }, stale))).toEqual([])
    expect(sessionsNotForCartTotal(cart({ total: 36, payment_collection: null }))).toEqual([])
    expect(sessionsNotForCartTotal(cart({ total: 36 }, [{ amount: 32, status: "canceled" }]))).toEqual([])
    // A session with no id cannot be named.
    expect(sessionsNotForCartTotal(cart({ total: 36 }, [{ id: null, amount: 32 }]))).toEqual([])
  })
})

describe("paymentsLeftWithoutSession: the payments no completion can use and a capture would still take", () => {
  type Payment = { id?: string | null; payment_session_id?: string | null; captured_at?: unknown; canceled_at?: unknown }
  const withPayments = (sessionIds: Array<string | null> | null | undefined, payments: Array<Payment | null> | null | undefined, overrides: Partial<CartPaymentAmounts> = {}) =>
    ({
      id: "cart_1",
      completed_at: null,
      total: 36,
      currency_code: "usd",
      payment_collection: {
        payment_sessions: sessionIds === null || sessionIds === undefined ? sessionIds : sessionIds.map((id) => (id === null ? null : { id, amount: 36, status: "pending" })),
        payments,
      },
      ...overrides,
    }) as CartPaymentAmounts

  it("names a payment whose session is gone and that captured nothing, saying whether Medusa already cancelled it", () => {
    // The authorized session for 32 was deleted (its intent cancelled) and
    // the row stayed; and what a failed completion's compensation leaves once
    // the next session replaced the old one: cancelled, session gone.
    const cart = withPayments(
      ["payses_new"],
      [
        { id: "pay_live_orphan", payment_session_id: "payses_deleted", captured_at: null, canceled_at: null },
        { id: "pay_compensated", payment_session_id: "payses_replaced", captured_at: null, canceled_at: new Date() },
      ]
    )
    expect(paymentsLeftWithoutSession(cart)).toEqual([
      { id: "pay_live_orphan", canceled: false },
      { id: "pay_compensated", canceled: true },
    ])
  })

  it("leaves a payment whose session is still on the collection, whatever its state: that session is the one a completion would use", () => {
    const cart = withPayments(
      ["payses_held", "payses_compensated"],
      [
        { id: "pay_held", payment_session_id: "payses_held", captured_at: null, canceled_at: null },
        { id: "pay_compensated", payment_session_id: "payses_compensated", captured_at: null, canceled_at: new Date() },
      ]
    )
    expect(paymentsLeftWithoutSession(cart)).toEqual([])
  })

  it("never names a payment that captured: its money needs a refund, not a cancel", () => {
    const cart = withPayments([], [{ id: "pay_taken", payment_session_id: "payses_deleted", captured_at: new Date(), canceled_at: null }])
    expect(paymentsLeftWithoutSession(cart)).toEqual([])
  })

  it("never names a payment that names no session, or a row with no id: neither was left by a deleted session", () => {
    const cart = withPayments(
      [],
      [{ id: "pay_bookkeeping", payment_session_id: null, captured_at: null }, { id: "", payment_session_id: "payses_deleted" }, { payment_session_id: "payses_deleted" }, null]
    )
    expect(paymentsLeftWithoutSession(cart)).toEqual([])
  })

  it("names nothing on a completed cart: its payments are its order's", () => {
    const cart = withPayments([], [{ id: "pay_1", payment_session_id: "payses_deleted" }], { completed_at: new Date() })
    expect(paymentsLeftWithoutSession(cart)).toEqual([])
  })

  it("names nothing when the sessions were not read: with no list of the sessions that remain, every payment would look orphaned", () => {
    const orphan = [{ id: "pay_1", payment_session_id: "payses_1" }]
    expect(paymentsLeftWithoutSession(withPayments(undefined, orphan))).toEqual([])
    expect(paymentsLeftWithoutSession(withPayments(null, orphan))).toEqual([])
    expect(paymentsLeftWithoutSession({ ...withPayments([], orphan), payment_collection: null })).toEqual([])
  })

  it("names nothing when the payments were not read", () => {
    expect(paymentsLeftWithoutSession(withPayments([], undefined))).toEqual([])
    expect(paymentsLeftWithoutSession(withPayments([], null))).toEqual([])
  })

  it("does not depend on the amounts: a payment without its session is unusable for any total, the right one included", () => {
    const cart = withPayments([null], [{ id: "pay_1", payment_session_id: "payses_deleted" }], { total: null, currency_code: "xxx" })
    expect(paymentsLeftWithoutSession(cart)).toEqual([{ id: "pay_1", canceled: false }])
  })
})

describe("the answers", () => {
  it("a completion refused for its session's amount: 409, a stable code, the buyer's message and no ids", () => {
    expect(cartPaymentAmountMismatchResponse()).toEqual({
      status: 409,
      body: { code: "cart_payment_amount_mismatch", type: "cart_payment_amount_mismatch", message: CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE },
    })
    expect(CART_PAYMENT_AMOUNT_MISMATCH).toBe("cart_payment_amount_mismatch")
    expect(CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE).toMatch(/was not placed/)
    expect(CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE).toMatch(/choose your payment method again/)
  })

  it("each reason has the message that is true for it, under the one status and code", () => {
    const body = (message: string) => ({ code: "cart_payment_amount_mismatch", type: "cart_payment_amount_mismatch", message })
    expect(cartPaymentAmountMismatchResponse("session_amount_mismatch")).toEqual({ status: 409, body: body(CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE) })
    expect(cartPaymentAmountMismatchResponse("captured_amount_mismatch")).toEqual({ status: 409, body: body(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE) })
    expect(cartPaymentAmountMismatchResponse("amount_unknown")).toEqual({ status: 409, body: body(CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE) })

    // Money was taken: nothing says it was not, and nothing sends the buyer to pay again.
    expect(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE).toMatch(/was not placed/)
    expect(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE).toMatch(/has already been taken/)
    expect(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE).not.toMatch(/not charged|payment method again/)
    // Nothing is known about the total: nothing says it changed.
    expect(CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE).toMatch(/was not placed/)
    expect(CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE).toMatch(/try again/)
    expect(CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE).not.toMatch(/total changed|payment method again/)
  })

  it("the refusal as an error: not_allowed, the code, and the reason's message, for a workflow to throw", () => {
    const error = new CartPaymentAmountError("captured_amount_mismatch")
    expect(error).toBeInstanceOf(MedusaError)
    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.code).toBe("cart_payment_amount_mismatch")
    expect(error.message).toBe(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE)
    expect(error.reason).toBe("captured_amount_mismatch")
    expect(isCartPaymentAmountRefusal(error)).toBe(true)
  })

  it("is known by its code alone, as an error that crossed a workflow boundary arrives", () => {
    expect(isCartPaymentAmountRefusal({ code: "cart_payment_amount_mismatch" })).toBe(true)
    for (const other of [null, undefined, "cart_payment_amount_mismatch", {}, { code: "cart_completion_incomplete" }, new Error("x")]) {
      expect(isCartPaymentAmountRefusal(other)).toBe(false)
    }
  })

  it("answers that error with one of its own messages and nothing else the error carries", () => {
    const code = "cart_payment_amount_mismatch" as const
    expect(cartPaymentAmountRefusalResponse(new CartPaymentAmountError("session_amount_mismatch"))).toEqual(cartPaymentAmountMismatchResponse())
    expect(cartPaymentAmountRefusalResponse({ code, reason: "captured_amount_mismatch" }).body.message).toBe(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE)
    // The reason was lost on the way: the message says which it was.
    expect(cartPaymentAmountRefusalResponse({ code, message: CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE }).body.message).toBe(
      CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE
    )
    // Neither is one of ours: the message that claims least, never the error's text.
    const unknown = cartPaymentAmountRefusalResponse({ code, reason: "toString", message: "relation \"cart\" does not exist" })
    expect(unknown).toEqual(cartPaymentAmountMismatchResponse("amount_unknown"))
  })

  it("a cart write whose payment could not be refreshed: 500, a stable code, and a message that says what puts it right", () => {
    expect(cartPaymentRefreshFailedResponse()).toEqual({
      status: 500,
      body: { code: "cart_payment_refresh_failed", type: "cart_payment_refresh_failed", message: CART_PAYMENT_REFRESH_FAILED_MESSAGE },
    })
    expect(CART_PAYMENT_REFRESH_FAILED).toBe("cart_payment_refresh_failed")
    // Not "try again": a repeated delivery choice is refused before it
    // writes, and a repeated removal finds nothing to remove, so neither
    // reaches the refresh. The completion check is what holds for every route.
    expect(CART_PAYMENT_REFRESH_FAILED_MESSAGE).not.toMatch(/try again/i)
    expect(CART_PAYMENT_REFRESH_FAILED_MESSAGE).toMatch(/checked against the new total before your order is placed/)
    expect(CART_PAYMENT_REFRESH_FAILED_MESSAGE).toMatch(/choose your payment method again/)
  })

  it("a reprice asked of a completed cart: 400 invalid_data, as Medusa's own cart writes answer one, with a code", () => {
    expect(cartAlreadyCompletedResponse()).toEqual({
      status: 400,
      body: { code: "cart_already_completed", type: "invalid_data", message: CART_ALREADY_COMPLETED_MESSAGE },
    })
  })
})
